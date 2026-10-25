import { useRef, type ChangeEvent } from 'react';
import { canUseNativeSystemFilePicker, pickNativeSystemFiles } from '../../native/systemPickedFiles';

export type RoomProjectFilePickerOptions = {
  accept?: string;
  disabled: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
};

export function useRoomProjectFilePicker({
  accept,
  disabled,
  multiple = false,
  onFiles
}: RoomProjectFilePickerOptions) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openPicker = async () => {
    if (disabled) return;
    if (canUseNativeSystemFilePicker()) {
      const files = await pickNativeSystemFiles({ accept, multiple });
      if (files.length > 0) await onFiles(files);
      return;
    }
    inputRef.current?.click();
  };
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.currentTarget.value = '';
    void onFiles(files);
  };
  return { inputRef, openPicker, handleInputChange };
}
