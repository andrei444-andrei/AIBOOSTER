import type { FormHTMLAttributes, HTMLAttributes } from "react";
import styles from "./Form.module.css";

export interface FormProps extends FormHTMLAttributes<HTMLFormElement> {}

export function Form({ className, children, ...rest }: FormProps) {
  return (
    <form className={[styles.form, className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </form>
  );
}

export function FormRow({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.row, className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function FormActions({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.actions, className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
