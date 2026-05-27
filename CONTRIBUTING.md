# Contributing to Artifact Explorer

Thanks for your interest in contributing! This document covers the dev setup, the expectations for pull requests, and how to report bugs or propose features.

## Development setup

1. Fork the repository.
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-github-username>/artifact-explorer.git
   cd artifact-explorer
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy the example environment file (only needed if you want to develop SBOM Search features):
   ```bash
   cp .env.example .env.local
   # then fill in DATABASE_URL and CRON_SECRET
   ```
5. Start the dev server:
   ```bash
   npm run dev
   ```

## Code style and guidelines

- Follow the existing code style in the project.
- Use **TypeScript** everywhere (`.ts` / `.tsx`).
- Use **functional components with hooks** for React code.
- Use **Tailwind CSS** for styling.
- Keep components small and focused; extract shared logic into `app/utils/` or `app/hooks/`.
- Write clear, self-documenting code; add comments only where the *why* isn't obvious from the code.

## Pull request process

1. Create a topic branch (`git checkout -b feat/short-description`).
2. Make your changes.
3. Make sure linting passes and the build succeeds:
   ```bash
   npm run lint
   npm run build
   ```
4. Run the relevant Playwright tests:
   ```bash
   npm run test:api     # fast — usually enough for backend changes
   npm test             # full suite — for UI changes
   ```
5. Open a pull request against `main` with:
   - A clear description of what changed and why
   - Screenshots or terminal output for visible changes
   - A reference to the issue it closes (if any)

A maintainer will review and either merge or request changes.

## Reporting bugs

When opening a bug report, please include:

- A clear description of the bug
- Steps to reproduce
- Expected behavior vs. actual behavior
- Screenshots if applicable
- Browser, OS, and Node version

## Feature requests

Feature requests are welcome! Please include:

- A clear description of the proposed feature
- Why you believe it would be valuable
- Any design or implementation ideas you have

## License

By contributing to Artifact Explorer, you agree that your contributions will be licensed under the [MIT License](LICENSE).
