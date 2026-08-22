"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from "react";
import styles from "./Input.module.css";

interface BaseFieldProps {
  label?: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  required?: boolean;
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    BaseFieldProps {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, errorText, required, id, className, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helpId = helperText ? `${inputId}-help` : undefined;
  const errId = errorText ? `${inputId}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;

  return (
    <label htmlFor={inputId} className={styles.field}>
      {label ? (
        <span className={styles.label}>
          {label}
          {required ? <span className={styles.required} aria-hidden>*</span> : null}
        </span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={describedBy}
        className={[styles.input, errorText ? styles.invalid : "", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      />
      {helperText && !errorText ? (
        <span id={helpId} className={styles.help}>
          {helperText}
        </span>
      ) : null}
      {errorText ? (
        <span id={errId} className={styles.error}>
          {errorText}
        </span>
      ) : null}
    </label>
  );
});

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    BaseFieldProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, helperText, errorText, required, id, className, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helpId = helperText ? `${inputId}-help` : undefined;
  const errId = errorText ? `${inputId}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;

  return (
    <label htmlFor={inputId} className={styles.field}>
      {label ? (
        <span className={styles.label}>
          {label}
          {required ? <span className={styles.required} aria-hidden>*</span> : null}
        </span>
      ) : null}
      <textarea
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={describedBy}
        className={[styles.textarea, errorText ? styles.invalid : "", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      />
      {helperText && !errorText ? (
        <span id={helpId} className={styles.help}>
          {helperText}
        </span>
      ) : null}
      {errorText ? (
        <span id={errId} className={styles.error}>
          {errorText}
        </span>
      ) : null}
    </label>
  );
});
