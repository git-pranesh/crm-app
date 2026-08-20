---
name: Deployment uv lock
description: How a stale generated Python environment can block this otherwise pnpm-only CRM from publishing.
---

When publishing, Replit runs `uv lock` because the workspace includes an otherwise empty `pyproject.toml`. A partial `.pythonlibs` directory without its Python executable makes that command fail before any application build runs.

**Why:** Replit-generated Python environment folders are ignored and can be left incomplete; `uv` treats the folder as its virtual environment but cannot use it without an interpreter.

**How to apply:** If a future publish fails with “`.pythonlibs` cannot be used because it is not a valid Python environment,” move the ignored stale directory out of the workspace and rerun `uv lock`. Keep the generated `uv.lock`; do not remove the CRM’s Node dependencies or change the production artifact build settings for this issue.