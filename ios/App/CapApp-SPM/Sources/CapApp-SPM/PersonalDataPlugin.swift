import Capacitor
import EventKit
import Foundation

@objc(PersonalDataPlugin)
public class PersonalDataPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PersonalDataPlugin"
    public let jsName = "PersonalData"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestCalendarAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listCalendars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readCalendarEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createCalendarEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateCalendarEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCalendarEvent", returnType: CAPPluginReturnPromise)
    ]

    private let eventStore = EKEventStore()
    private let isoFormatter = ISO8601DateFormatter()

    @objc public func getStatus(_ call: CAPPluginCall) {
        call.resolve(buildStatus())
    }

    @objc public func requestCalendarAccess(_ call: CAPPluginCall) {
        let complete: (Bool, Error?) -> Void = { _, error in
            DispatchQueue.main.async {
                if let error {
                    call.reject("请求日历权限失败。", nil, error)
                    return
                }
                call.resolve(self.buildStatus())
            }
        }

        if #available(iOS 17.0, *) {
            eventStore.requestFullAccessToEvents(completion: complete)
        } else {
            eventStore.requestAccess(to: .event, completion: complete)
        }
    }

    @objc public func readCalendarEvents(_ call: CAPPluginCall) {
        guard calendarCanReadEvents() else {
            call.reject("当前没有系统日历读取权限。请在 Polaris 设置里开启系统资料，并在 iOS 权限弹窗里允许完整日历访问。")
            return
        }

        let range = readDateRange(call, defaultDays: 14)
        let maxEvents = call.getInt("maxEvents") ?? 50
        let query = call.getString("query")?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let predicate = eventStore.predicateForEvents(withStart: range.start, end: range.end, calendars: nil)
        let events = eventStore.events(matching: predicate)
            .filter { event in
                guard let query, !query.isEmpty else { return true }
                return event.title.lowercased().contains(query)
                    || (event.location?.lowercased().contains(query) ?? false)
                    || event.calendar.title.lowercased().contains(query)
            }
            .sorted { lhs, rhs in lhs.startDate < rhs.startDate }
            .prefix(max(0, maxEvents))

        let resultEvents = events.map { event in
            serializeCalendarEvent(event)
        }
        let detailText = formatCalendarEvents(resultEvents)
        call.resolve([
            "summary": "已读取系统日历 · \(resultEvents.count) 条",
            "detailText": detailText,
            "events": resultEvents
        ])
    }

    @objc public func listCalendars(_ call: CAPPluginCall) {
        guard calendarCanReadEvents() else {
            call.reject("当前没有系统日历完整访问权限，不能读取可选日历。")
            return
        }

        eventStore.refreshSourcesIfNecessary()
        let defaultCalendarId = eventStore.defaultCalendarForNewEvents?.calendarIdentifier
        let calendars = eventStore.calendars(for: .event)
            .filter { $0.allowsContentModifications }
            .sorted { lhs, rhs in
                if lhs.calendarIdentifier == defaultCalendarId { return true }
                if rhs.calendarIdentifier == defaultCalendarId { return false }
                let sourceOrder = lhs.source.title.localizedCaseInsensitiveCompare(rhs.source.title)
                if sourceOrder != .orderedSame { return sourceOrder == .orderedAscending }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
            .map { serializeCalendar($0, defaultCalendarId: defaultCalendarId) }

        call.resolve([
            "summary": "已读取可写系统日历 · \(calendars.count) 个",
            "detailText": formatCalendars(calendars),
            "calendars": calendars
        ])
    }

    @objc public func createCalendarEvent(_ call: CAPPluginCall) {
        guard calendarCanWriteEvents() else {
            call.reject("当前没有系统日历写入权限。请在 Polaris 设置里开启系统资料，并在 iOS 权限弹窗里允许日历访问。")
            return
        }
        guard let title = trimmed(call.getString("title")), !title.isEmpty else {
            call.reject("创建日程缺少标题。")
            return
        }
        guard let startDate = parseDate(call.getString("startDate")) else {
            call.reject("创建日程缺少有效开始时间。")
            return
        }
        let parsedEndDate = parseDate(call.getString("endDate"))
        let endDate = parsedEndDate ?? Calendar.current.date(byAdding: .hour, value: 1, to: startDate) ?? startDate
        eventStore.refreshSourcesIfNecessary()
        let requestedCalendarId = trimmed(call.getString("calendarId"))
        let calendar: EKCalendar
        if let requestedCalendarId {
            guard let selectedCalendar = eventStore.calendar(withIdentifier: requestedCalendarId) else {
                call.reject("没有找到 calendarId 对应的系统日历。请先读取可写日历再重试。")
                return
            }
            guard selectedCalendar.allowsContentModifications else {
                call.reject("calendarId 对应的系统日历不可写。请改用其他可写日历。")
                return
            }
            calendar = selectedCalendar
        } else {
            guard let defaultCalendar = eventStore.defaultCalendarForNewEvents,
                  defaultCalendar.allowsContentModifications else {
                call.reject("当前设备没有可写入的默认日历。请先在系统日历里设置默认日历。")
                return
            }
            calendar = defaultCalendar
        }

        let event = EKEvent(eventStore: eventStore)
        event.calendar = calendar
        event.title = title
        event.startDate = min(startDate, endDate)
        event.endDate = max(startDate, endDate)
        event.isAllDay = call.getBool("allDay") ?? false
        event.location = trimmed(call.getString("location")) ?? ""
        event.notes = trimmed(call.getString("notes")) ?? ""

        do {
            try eventStore.save(event, span: .thisEvent, commit: true)
            let serialized = serializeCalendarEvent(event)
            call.resolve([
                "summary": "已创建系统日历事件 · \(title)",
                "detailText": formatCalendarEvents([serialized]),
                "event": serialized
            ])
        } catch {
            call.reject("创建日历事件失败。", nil, error)
        }
    }

    @objc public func updateCalendarEvent(_ call: CAPPluginCall) {
        guard calendarCanModifyExistingEvents() else {
            call.reject("当前没有系统日历完整访问权限，不能修改已有日程。")
            return
        }
        guard let eventId = trimmed(call.getString("eventId")), !eventId.isEmpty else {
            call.reject("修改日程缺少 eventId。")
            return
        }
        guard let event = eventStore.event(withIdentifier: eventId) else {
            call.reject("没有找到要修改的日历事件。")
            return
        }

        if let title = trimmed(call.getString("title")), !title.isEmpty {
            event.title = title
        }
        if let startDate = parseDate(call.getString("startDate")) {
            event.startDate = startDate
        }
        if let endDate = parseDate(call.getString("endDate")) {
            event.endDate = endDate
        }
        if event.endDate < event.startDate {
            event.endDate = event.startDate
        }
        if let allDay = call.getBool("allDay") {
            event.isAllDay = allDay
        }
        if let location = trimmed(call.getString("location")) {
            event.location = location
        }
        if let notes = trimmed(call.getString("notes")) {
            event.notes = notes
        }

        do {
            try eventStore.save(event, span: .thisEvent, commit: true)
            let serialized = serializeCalendarEvent(event)
            call.resolve([
                "summary": "已修改系统日历事件 · \(event.title ?? "未命名日程")",
                "detailText": formatCalendarEvents([serialized]),
                "event": serialized
            ])
        } catch {
            call.reject("修改日历事件失败。", nil, error)
        }
    }

    @objc public func deleteCalendarEvent(_ call: CAPPluginCall) {
        guard calendarCanModifyExistingEvents() else {
            call.reject("当前没有系统日历完整访问权限，不能删除已有日程。")
            return
        }
        guard let eventId = trimmed(call.getString("eventId")), !eventId.isEmpty else {
            call.reject("删除日程缺少 eventId。")
            return
        }
        guard let event = eventStore.event(withIdentifier: eventId) else {
            call.reject("没有找到要删除的日历事件。")
            return
        }

        let serialized = serializeCalendarEvent(event)
        let title = event.title ?? "未命名日程"
        do {
            try eventStore.remove(event, span: .thisEvent, commit: true)
            call.resolve([
                "summary": "已删除系统日历事件 · \(title)",
                "detailText": formatCalendarEvents([serialized]),
                "event": serialized
            ])
        } catch {
            call.reject("删除日历事件失败。", nil, error)
        }
    }

    private func buildStatus() -> [String: Any] {
        let calendarPermission = calendarPermissionStatus()
        return [
            "platform": "ios",
            "calendar": [
                "available": true,
                "permission": calendarPermission,
                "detail": calendarPermission == "writeOnly" ? "当前只有写入日历权限，可以创建新日程，但不能读取、修改或删除已有事件。" : ""
            ],
            "health": [
                "available": false,
                "permission": "unavailable",
                "detail": "这版暂未开放健康资料工具。"
            ]
        ]
    }

    private func calendarPermissionStatus() -> String {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            switch status {
            case .fullAccess:
                return "authorized"
            case .writeOnly:
                return "writeOnly"
            case .notDetermined:
                return "notDetermined"
            case .denied:
                return "denied"
            case .restricted:
                return "restricted"
            @unknown default:
                return "unavailable"
            }
        }

        switch status {
        case .authorized:
            return "authorized"
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        @unknown default:
            return "unavailable"
        }
    }

    private func calendarCanReadEvents() -> Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            return status == .fullAccess
        }
        return status == .authorized
    }

    private func calendarCanWriteEvents() -> Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) {
            return status == .fullAccess || status == .writeOnly
        }
        return status == .authorized
    }

    private func calendarCanModifyExistingEvents() -> Bool {
        calendarCanReadEvents() && calendarCanWriteEvents()
    }

    private func readDateRange(_ call: CAPPluginCall, defaultDays: Int) -> (start: Date, end: Date) {
        let end = parseDate(call.getString("endDate")) ?? Date()
        let start = parseDate(call.getString("startDate"))
            ?? Calendar.current.date(byAdding: .day, value: -defaultDays, to: end)
            ?? end
        return start <= end ? (start, end) : (end, start)
    }

    private func parseDate(_ value: String?) -> Date? {
        guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        if let date = isoFormatter.date(from: raw) {
            return date
        }
        let cleaned = raw
            .replacingOccurrences(of: "[（(][^）)]*[）)]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "的", with: " ")
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let posixFormats = [
            "yyyy-MM-dd",
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
            "yyyy-MM-dd'T'HH:mm:ss"
        ]
        for format in posixFormats {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = format
            if let date = formatter.date(from: cleaned) {
                return date
            }
        }

        let zhFormats = [
            "yyyy-MM-dd a h:mm",
            "yyyy-MM-dd a h:mm:ss",
            "yyyy-MM-dd ah:mm",
            "yyyy-MM-dd ah:mm:ss"
        ]
        for format in zhFormats {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "zh_CN")
            formatter.dateFormat = format
            if let date = formatter.date(from: cleaned) {
                return date
            }
        }

        return nil
    }

    private func trimmed(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func serializeCalendarEvent(_ event: EKEvent) -> [String: Any] {
        [
            "eventId": event.eventIdentifier ?? "",
            "title": event.title ?? "未命名日程",
            "startDate": isoFormatter.string(from: event.startDate),
            "endDate": isoFormatter.string(from: event.endDate),
            "calendarId": event.calendar.calendarIdentifier,
            "calendarName": event.calendar.title,
            "calendarSource": event.calendar.source.title,
            "calendarSourceType": sourceTypeLabel(event.calendar.source.sourceType),
            "allDay": event.isAllDay,
            "location": event.location ?? "",
            "notes": event.notes ?? ""
        ] as [String: Any]
    }

    private func serializeCalendar(_ calendar: EKCalendar, defaultCalendarId: String?) -> [String: Any] {
        [
            "calendarId": calendar.calendarIdentifier,
            "calendarName": calendar.title,
            "sourceId": calendar.source.sourceIdentifier,
            "sourceName": calendar.source.title,
            "sourceType": sourceTypeLabel(calendar.source.sourceType),
            "isDefault": calendar.calendarIdentifier == defaultCalendarId,
            "allowsContentModifications": calendar.allowsContentModifications
        ] as [String: Any]
    }

    private func sourceTypeLabel(_ sourceType: EKSourceType) -> String {
        switch sourceType {
        case .local:
            return "local"
        case .exchange:
            return "exchange"
        case .calDAV:
            return "calDAV"
        case .mobileMe:
            return "mobileMe"
        case .subscribed:
            return "subscribed"
        case .birthdays:
            return "birthdays"
        @unknown default:
            return "unknown"
        }
    }

    private func formatCalendars(_ calendars: [[String: Any]]) -> String {
        if calendars.isEmpty {
            return "当前没有读到可写的系统日历。"
        }
        return calendars.enumerated().map { index, calendar in
            let calendarId = calendar["calendarId"] as? String ?? ""
            let calendarName = calendar["calendarName"] as? String ?? "未命名日历"
            let sourceName = calendar["sourceName"] as? String ?? ""
            let sourceType = calendar["sourceType"] as? String ?? "unknown"
            let isDefault = calendar["isDefault"] as? Bool ?? false
            return "\(index + 1). \(calendarName)\(isDefault ? " · 系统默认" : "")\n   calendarId=\(calendarId)\n   source=\(sourceName) · \(sourceType)"
        }.joined(separator: "\n\n")
    }

    private func formatCalendarEvents(_ events: [[String: Any]]) -> String {
        if events.isEmpty {
            return "这个时间段里没有读到匹配的日历事件。"
        }
        return events.enumerated().map { index, event in
            let eventId = event["eventId"] as? String ?? ""
            let title = event["title"] as? String ?? "未命名日程"
            let startDate = event["startDate"] as? String ?? ""
            let endDate = event["endDate"] as? String ?? ""
            let calendarId = event["calendarId"] as? String ?? ""
            let calendarName = event["calendarName"] as? String ?? ""
            let calendarSource = event["calendarSource"] as? String ?? ""
            let calendarSourceType = event["calendarSourceType"] as? String ?? ""
            let location = event["location"] as? String ?? ""
            return "\(index + 1). \(title)\n   eventId=\(eventId)\n   \(startDate) - \(endDate)\n   calendar=\(calendarName) · \(calendarSource) · \(calendarSourceType)\n   calendarId=\(calendarId)\(location.isEmpty ? "" : "\n   location=\(location)")"
        }.joined(separator: "\n\n")
    }

}
