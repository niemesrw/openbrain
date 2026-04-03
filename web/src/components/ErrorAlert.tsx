import React from "react";

type ErrorAlertProps = React.HTMLAttributes<HTMLDivElement> & {
  message: string;
};

export function ErrorAlert({
  message,
  className,
  ...divProps
}: ErrorAlertProps) {
  const combinedClassName =
    "bg-brain-error/10 text-brain-error px-4 py-2 rounded-lg mb-4 font-label text-sm" +
    (className ? ` ${className}` : "");

  return (
    <div
      role="alert"
      aria-live="polite"
      className={combinedClassName}
      {...divProps}
    >
      {message}
    </div>
  );
}
