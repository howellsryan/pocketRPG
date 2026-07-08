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
   Pass "key" for a deliberate path (models/<item>.v1.glb, images/...); omit it for
   a random UUID key.
4. get_asset — pull a stored asset's raw bytes back as base64 (capped ~15 MiB — fine
   for images, likely too large for a full 3D model file; use the url from
   store_asset for those instead) so it can be written into the repo, e.g.
   public/world/map.webp with src/data/world.json's mapImage.
5. upload_asset — push base64 bytes straight into R2 under a chosen key. This is how
   locally-processed files (e.g. a GLB shrunk by scripts/process-3d-model.mjs) get
   hosted without a human running wrangler.

Equipment 3D models are hosted from R2: upload the PROCESSED GLB to a
models/<item>.vN.glb key and reference "/api/tripo-assets/models/<item>.vN.glb" in
src/data/equipmentModels.json (never bump an existing vN — the serving route caches
immutably; add vN+1 instead). scripts/tripo-item-model.mjs automates the whole
prompt→R2→registry pipeline.

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
        key: {
          type: 'string',
          description:
            'Optional stable storage key (e.g. "models/dragon_scimitar.v1.glb", "images/worldmap.v2.webp"). Served immutably at /api/tripo-assets/<key>, so never reuse a key — bump the version instead. Omit for a random UUID key.',
        },
        content_type: { type: 'string', description: 'Optional Content-Type override when the source URL reports a generic one.' },
        task_id: { type: 'string', description: 'Optional, recorded as metadata for traceability.' },
        filename: { type: 'string', description: 'Optional, recorded as metadata (e.g. "map.webp").' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: WRITE('Store a Tripo asset'),
  },
  {
    name: 'upload_asset',
    description:
      'Upload raw bytes (base64) directly into PocketRPG\'s R2 asset storage — the counterpart to get_asset for the write direction. Use it to host files produced outside Tripo, e.g. a GLB optimised by scripts/process-3d-model.mjs, under a stable key like "models/<item>.v1.glb" that src/data/equipmentModels.json can reference as "/api/tripo-assets/models/<item>.v1.glb". Decoded size cap ~25 MiB; keys are served immutably, so bump the version rather than overwriting.',
    inputSchema: {
      type: 'object',
      properties: {
        base64: { type: 'string', description: 'The asset bytes, base64-encoded.' },
        content_type: { type: 'string', description: 'Content-Type to serve, e.g. "model/gltf-binary", "image/webp".' },
        key: {
          type: 'string',
          description: 'Optional stable storage key (e.g. "models/dragon_scimitar.v1.glb"). Omit for a random UUID key.',
        },
        task_id: { type: 'string', description: 'Optional, recorded as metadata for traceability.' },
        filename: { type: 'string', description: 'Optional, recorded as metadata.' },
      },
      required: ['base64', 'content_type'],
      additionalProperties: false,
    },
    annotations: WRITE('Upload an asset to R2'),
  },
  {
    name: 'get_asset',
    description:
      'Fetch a previously stored asset\'s raw bytes as base64, keyed by the key returned from store_asset/upload_asset. Capped around 15 MiB per call; for larger files (e.g. a raw GLB) pass offset/length and reassemble the chunks, or fetch the store_asset url directly. Use this to pull a generated asset into a coding session for local processing or writing into the repo.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        offset: { type: 'number', description: 'Byte offset to start from (chunked reads of large assets).' },
        length: { type: 'number', description: 'Byte count to return (capped at ~15 MiB per call).' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    annotations: READ('Get a stored Tripo asset'),
  },
]

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name)
