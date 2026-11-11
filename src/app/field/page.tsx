import Script from "next/script";
import { FieldApp } from "./field-app";

export const metadata = { title: "Field tasks" };

/** The Telegram Mini App. Telegram's script provides signed init data and location access. */
export default function FieldPage() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <FieldApp />
    </>
  );
}
