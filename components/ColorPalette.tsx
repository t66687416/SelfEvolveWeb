import React from 'react';
import { ColorInfo } from '../types';
import Icon from './Icon';

interface ColorPaletteProps {
  palette: ColorInfo[];
}

const ColorCard: React.FC<{ color: ColorInfo }> = ({ color }) => {
  const [copied, setCopied] = React.useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(color.hex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Determine if text should be light or dark based on background
  const getTextColor = (hex: string) => {
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? 'text-black' : 'text-white';
  }

  const textColor = getTextColor(color.hex);

  return (
    <div className="relative w-full h-24 rounded-lg flex flex-col justify-end p-3 shadow-md transition-transform hover:scale-105" style={{ backgroundColor: color.hex }}>
        <div className={`font-mono text-sm font-semibold tracking-wider ${textColor}`}>{color.hex}</div>
        <div className={`text-xs truncate ${textColor}`}>{color.name}</div>
        <button
            onClick={copyToClipboard}
            className={`absolute top-2 right-2 p-1.5 rounded-full transition ${textColor} bg-white/20 hover:bg-white/40`}
            aria-label={`Copy hex code ${color.hex}`}
        >
            {copied ? <Icon name="check" className="w-4 h-4" /> : <Icon name="copy" className="w-4 h-4" />}
        </button>
    </div>
  );
};

const ColorPalette: React.FC<ColorPaletteProps> = ({ palette }) => {
  return (
    <div className="w-full">
        <h2 className="text-xl font-bold text-slate-700 mb-4 text-center">Generated Palette</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {palette.map((color, index) => (
                <ColorCard key={index} color={color} />
            ))}
        </div>
    </div>
  );
};

export default ColorPalette;