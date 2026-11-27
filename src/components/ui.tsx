'use client';
import { X, ArrowLeft, LoaderCircle, Minus, Plus, AlertCircle, Check } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
export function PageTitle({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      {back && (
        <Link href={back} className="icon-button" aria-label="Go back">
          <ArrowLeft size={22} />
        </Link>
      )}
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="title-action">{action}</div>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="skeletons" aria-label="Loading">
      <div className="skeleton tall" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Check size={30} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Quantity({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="quantity">
      <button aria-label="Decrease quantity" onClick={() => onChange(value - 1)}>
        <Minus size={15} />
      </button>
      <span>{value}</span>
      <button
        aria-label="Increase quantity"
        disabled={value >= 99}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
export function Busy({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <>
      {busy && <LoaderCircle size={17} className="spin" />}
      {children}
    </>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
