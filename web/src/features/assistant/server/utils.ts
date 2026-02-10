import { Langfuse } from "langfuse";

let langfuseClient: Langfuse | null = null;

export function getLangfuseClient(
  publicKey: string,
  secretKey: string,
  baseUrl?: string,
): Langfuse {
  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      publicKey,
      secretKey,
      baseUrl,
    });
  }
  return langfuseClient;
}
