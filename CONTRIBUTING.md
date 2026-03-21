# Contributing to QueryPad

Thanks for your interest in contributing to QueryPad!

## Development Setup

```bash
git clone https://github.com/vericontext/querypad.git
cd querypad
npm install
npm run dev
```

The app will be available at `http://localhost:3000`.

## Project Structure

```
src/
  app/        # Next.js app router pages and API routes
  components/ # React components
  lib/        # Core logic (DuckDB, AI, utilities)
  stores/     # Zustand state management
  types/      # TypeScript type definitions
```

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run the linter (`npm run lint`)
5. Commit your changes
6. Push to your fork and open a Pull Request

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Follow existing code style and conventions
- Test your changes locally before submitting

## Reporting Issues

- Use [GitHub Issues](https://github.com/vericontext/querypad/issues)
- Include steps to reproduce, expected behavior, and actual behavior
- Screenshots are helpful for UI-related issues

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
