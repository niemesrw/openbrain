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
    "bg-red-900/50 text-red-300 px-4 py-2 rounded mb-4" +
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
