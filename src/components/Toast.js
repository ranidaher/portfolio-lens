import { useEffect } from 'react';
import { Icons } from './Icons';

export default function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  
  return (
    <div className={`toast ${type}`}>
      {type === 'success' ? Icons.check : Icons.alert}
      {message}
    </div>
  );
}
