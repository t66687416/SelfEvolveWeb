import React from 'react';
import Icon from './Icon';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  previewUrl: string | null;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, selectedFile, previewUrl }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/png, image/jpeg, image/webp"
      />
      <div
        className="w-full aspect-square bg-slate-100 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center text-center p-6 cursor-pointer hover:bg-slate-200 hover:border-slate-400 transition-colors"
        onClick={handleClick}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Pet preview" className="max-h-full max-w-full object-contain rounded-md" />
        ) : (
          <>
            <Icon name="upload" className="w-12 h-12 text-slate-400 mb-2" />
            <p className="text-slate-600 font-semibold">Click to upload an image</p>
            <p className="text-xs text-slate-500 mt-1">PNG, JPG, or WEBP</p>
          </>
        )}
      </div>
      {selectedFile && <p className="text-sm text-slate-500 mt-2 text-center truncate">Selected: {selectedFile.name}</p>}
    </div>
  );
};

export default FileUpload;