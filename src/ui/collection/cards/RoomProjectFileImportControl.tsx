import type { ReactNode } from 'react';
import { useRoomProjectFilePicker } from '../../../app/collection/useRoomProjectFilePicker';

type FileImportControlProps = {
  className: string;
  accept?: string;
  disabled: boolean;
  multiple?: boolean;
  role?: string;
  onFiles: (files: File[]) => void | Promise<void>;
  children: ReactNode;
};

export function FileImportControl({
  className,
  accept,
  disabled,
  multiple = false,
  role,
  onFiles,
  children
}: FileImportControlProps) {
  const { inputRef, openPicker, handleInputChange } = useRoomProjectFilePicker({ accept, disabled, multiple, onFiles });
  return (
    <>
      <button
        type="button"
        className={`${className} room-project-file-import-action`}
        role={role}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => {
          void openPicker();
        }}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        className="room-project-file-import-input"
        type="file"
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleInputChange}
      />
    </>
  );
}
