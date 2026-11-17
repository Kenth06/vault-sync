// Drizzle migrations are bundled as text by the `rules` entry in wrangler.jsonc.
declare module "*.sql" {
  const content: string;
  export default content;
}
