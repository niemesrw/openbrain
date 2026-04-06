/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_MCP_URL: string;
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_WEB_CLIENT_ID: string;
  readonly VITE_COGNITO_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
