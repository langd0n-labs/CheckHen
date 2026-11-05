# CheckHen Project Layout

This document provides an overview of the project structure for CheckHen, a web application designed for managing class sessions, student check-ins, and real-time communication.

## Project Structure

### Root Directory
- **Dockerfile**: Defines the Docker image for the application.
- **docker-compose.yml**: Configuration for running the application and its dependencies using Docker Compose.
- **package.json**: Contains project metadata, dependencies, and scripts.
- **tsconfig.json**: TypeScript configuration file.
- **next.config.mjs**: Next.js configuration file.
- **.env**: Environment variables for the application.

### Directories

#### `/components`
Contains reusable UI components, such as:
- **Chat**: Chat interface for real-time communication.
- **TableScrollArea**: Scrollable table component.

#### `/pages`
Contains Next.js pages, including:
- **`/index.tsx`**: Home page.
- **`/admin`**: Admin-specific pages like dashboard and chat.
- **`/api`**: API routes for handling backend logic.

#### `/prisma`
Contains Prisma schema and migration files for database management:
- **schema.prisma**: Defines the database schema.
- **migrations/**: Stores migration files.

#### `/public`
Static assets such as images, fonts, and CSS files.

#### `/lib`
Utility libraries for the application:
- **prisma.ts**: Prisma client setup.
- **socket.ts**: WebSocket client setup.

#### `/theme.ts`
Mantine theme configuration for consistent styling.

#### `/test-utils`
Utilities for testing, including custom render functions.

#### `/styles`
Global CSS and Tailwind configuration:
- **index.css**: Main CSS file.
- **tailwind.config.ts**: Tailwind CSS configuration.

#### `/storybook`
Configuration for Storybook, used for UI component development and testing.

### Configuration Files
- **`.gitignore`**: Specifies files and directories to ignore in Git.
- **`.dockerignore`**: Specifies files and directories to ignore in Docker builds.
- **`.prettierrc.mjs`**: Prettier configuration for code formatting.
- **`.eslint.config.mjs`**: ESLint configuration for linting.
- **`.stylelintrc.json`**: Stylelint configuration for CSS linting.
