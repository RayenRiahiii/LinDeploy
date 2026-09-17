# LinDeploy Frontend

React and TypeScript interface for LinDeploy, built with Vite and Mantine.

## Source Organization

- `src/pages`: route-level page composition;
- `src/components`: reusable UI grouped by domain;
- `src/features`: installer catalogs and execution presentation rules;
- `src/lib`: shared API parsing and error formatting;
- `src/context`: application-wide React context;
- `src/layouts`: shared application shell.

`RunDeployment.tsx` owns workflow orchestration. Reusable visual blocks such as
the deployment monitor and CRUD confirmation dialog live under `components`.

## Commands

```bash
npm ci
npm run dev
npm run build
npm run lint
```

Copy `.env.example` to `.env` and configure `VITE_DJANGO_BASE_URL` before
starting the development server.
