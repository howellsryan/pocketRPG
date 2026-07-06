// Static MCP tool metadata for the Tripo bridge (functions/api/tripo-mcp.js).
// Kept free of handler imports so it can be unit-tested cheaply, mirroring
// functions/_lib/mcp/schema.js. The dispatch table in tools.js must expose
// exactly these names.

const READ = (title) => ({ title, readOnlyHint: true, openWorldHint: true })
const WRITE = (title) => ({ title, readOnlyHint: false, destructiveHint: false, openWorldHint: true })

export const SERVER_INSTRUCTIONS = `This is PocketRPG's Tripo AI asset-generation bridge — a developer/content-pipeline
tool, not a player-facing feature. It exists because Tripo's API (api.tripo3d.ai) is
not reachable from network-restricted coding sandboxes; this Cloudflare Worker holds
the Tripo API key and proxies requests so an AI coding assistant can generate 3D
models and concept art for PocketRPG without needing its own egress to Tripo.

Workflow:
1. create_task — submit a generation job (type "text_to_model" for text-to-3D,
   "image_to_model" for image-to-3D, plus Tripo's other task types: "texture_model",
   "refine_model", "animate_rig", "stylize_model", "convert_model", ...). Returns a
   task_id.
2. get_task — poll the task_id until status is "success" (or "failed"/"cancelled"/
   "banned"/"expired"). On success, output includes a 3D model file URL and a
   rendered_image preview URL (a top-down/orthographic render of the model — this is
   what PocketRPG actually uses as 2D game art today; see scripts/tripo-worldmap.mjs).
3. store_asset — download a URL from the task's output server-side and persist it to
   PocketRPG's own R2 storage. Returns a stable, fetchable url plus a storage key.
4. get_asset — pull a stored asset's raw bytes back as base64 (capped ~15 MiB — fine
   for images, likely too large for a full 3D model file; use the url from
   store_asset for those instead) so it can be written into the repo, e.g.
   public/world/map.webp with src/data/world.json's mapImage.

Tripo's task API evolves independently of this bridge, so create_task forwards
"params" verbatim as the rest of the request body rather than re-validating
Tripo's schema — check Tripo's docs for the fields a given task type needs.`

export const TOOL_SCHEMAS = [
  {
    name: 'create_task',
    description:
      'Submit a generation job to Tripo AI. "type" selects the pipeline (e.g. "text_to_model" for text-to-3D, "image_to_model" for image-to-3D — see Tripo\'s task API docs for the full list). "params" is forwarded verbatim as the rest of the JSON body (prompt, file_token, model_version, texture, ...) since this tool does not re-validate Tripo\'s schema. Returns the created task_id; poll it with get_task. Spends the account\'s Tripo credits — confirm with the operator before generating unless they already asked for it.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Tripo task type, e.g. "text_to_model", "image_to_model".' },
        params: {
          type: 'object',
          description: 'Task-specific fields forwarded to Tripo verbatim (prompt, file_token, model_version, ...).',
          additionalProperties: true,
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    annotations: WRITE('Create Tripo generation task'),
  },
  {
    name: 'get_task',
    description:
      'Poll a Tripo task\'s status/progress/output by task_id. Statuses: queued, running, success, failed, cancelled, banned, expired. On success, output includes a 3D model file URL and a rendered_image preview URL. Pass a URL from output to store_asset to persist it.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
      additionalProperties: false,
    },
    annotations: READ('Get Tripo task status'),
  },
  {
    name: 'store_asset',
    description:
      "Download a URL from a finished Tripo task's output (model file or rendered_image) server-side and persist it to PocketRPG's own R2 storage. Returns a stable url you can open directly (e.g. to eyeball a rendered image in a browser) plus a storage key for get_asset.",
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: "A URL from a Tripo task's output." },
        task_id: { type: 'string', description: 'Optional, recorded as metadata for traceability.' },
        filename: { type: 'string', description: 'Optional, recorded as metadata (e.g. "map.webp").' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: WRITE('Store a Tripo asset'),
  },
  {
    name: 'get_asset',
    description:
      'Fetch a previously stored asset\'s raw bytes as base64, keyed by the key returned from store_asset. Capped around 15 MiB — fine for images, likely too large for a full 3D model file (use store_asset\'s url for those instead). Use this to pull a generated image directly into a coding session for writing into the repo.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
      additionalProperties: false,
    },
    annotations: READ('Get a stored Tripo asset'),
  },
]

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name)
