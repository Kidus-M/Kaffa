import { Inngest } from "inngest";

/** In development, set INNGEST_DEV=1 and run `npx inngest-cli@latest dev` to use the local dev server. */
export const inngest = new Inngest({ id: "kaffa" });
