<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Release and verification

- Keep `package.json`, `package-lock.json`, and the latest `CHANGELOG.md` release version in sync.
- Run `npm run check` after code/config changes, and `npm test` when UI behavior or e2e-covered flows change.
- Do not commit demo video artifacts; use them as release/README upload assets.
