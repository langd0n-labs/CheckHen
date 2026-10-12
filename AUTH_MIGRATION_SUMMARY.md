# CheckHen Auth.js Migration Summary

## Project Overview
CheckHen is a classroom management app for instructors and students at BU. It allows:
- **Instructors**: Start/end classes, view check-ins, monitor hand raises, chat with students
- **Students**: Check in to class, raise hand (virtual hand raise), chat with instructor

## What Was Accomplished

### ✅ Successfully Migrated from Clerk to Auth.js v4
**Reason for migration**: Clerk's free tier was causing 503 rate limit errors with many students

### Key Changes Made:

#### 1. Authentication System
- **Removed**: Clerk authentication (`@clerk/nextjs`)
- **Added**: Auth.js v4 (`next-auth@4.24.11`)
- **Provider**: Google OAuth with @bu.edu domain restriction
- **Admin users**: alicja, langd0n, aploog @bu.edu
- **Session management**: Server-side sessions with `getServerSession()`

#### 2. Database Schema Changes
- **Primary identifier**: Changed from `clerk_id` to `email`
- **Migration**: `20251027154430_make_clerk_id_optional`
- Made `clerk_id` field optional (String?)
- Added `email` field as required and unique

#### 3. Database Connection Fixed
- **Issue**: Wrong credentials in .env
- **Fixed**: Updated to `postgresql://ds490:ds490-secure-password@127.0.0.1:5432/postgres`
- **Docker**: PostgreSQL runs on port 5432

#### 4. Updated 30+ Files
All API routes now use Auth.js:
- `/api/get-clerk-info.ts` - Fetches user by email, creates if doesn't exist
- All `/api/admin/*` routes - Updated to use `getServerSession(req, res, authOptions)`
- All `/api/student/*` routes - Updated to use `getServerSession(req, res, authOptions)`
- All page components - Use `useSession()` hook from next-auth/react

#### 5. Removed Tailwind CSS
- **Issue**: Tailwind was conflicting with Mantine UI, making all buttons white/invisible
- **Solution**: Completely removed Tailwind, using only Mantine for styling
- Removed packages: `tailwindcss`, `autoprefixer`, `postcss` (as Tailwind deps)
- Updated `postcss.config.js` to use only Mantine presets
- Replaced Tailwind directives in `public/index.css` with basic global styles

#### 6. Fixed Styling Issues
- Updated `theme.ts` with blue color scheme and button defaults
- Buttons now visible with proper Mantine styling
- Fixed CSS import order in `_app.tsx`

## Current Project Structure

### Environment Variables (.env)
See `checkhen/.env.example` for the required environment variables. Copy it to `checkhen/.env` and fill in your secrets.

### Key Files

**Authentication:**
- `pages/api/auth/[...nextauth].ts` - Auth.js configuration with Google OAuth
- `middleware.ts` - Protects `/admin/*` routes
- `pages/_app.tsx` - SessionProvider wrapper

**Pages:**
- `pages/index.tsx` - Student check-in page (non-admins see this)
- `pages/admin/dashboard.tsx` - Admin dashboard (admins redirected here)
- `pages/admin/chat.tsx` - Admin chat interface
- `pages/chat.tsx` - Student chat interface
- `pages/student-test.tsx` - Test page for development (no auth needed)

**API Routes:**
- `pages/api/get-clerk-info.ts` - Gets/creates user by email
- `pages/api/fetch-latest-class.ts` - Gets current active class
- `pages/api/admin/start-new-class.ts` - Creates new class
- `pages/api/admin/end-class-early.ts` - Ends current class
- `pages/api/admin/fetch-check-ins.ts` - Gets all check-ins for current class
- `pages/api/admin/fetch-hand-raise.ts` - Gets unrated hand raises
- `pages/api/student/check-in.ts` - Student check-in endpoint
- `pages/api/student/toggle-vhr.ts` - Virtual hand raise toggle

## Current Status

### ✅ What's Working
1. **Authentication**: Google OAuth sign-in with @bu.edu restriction
2. **Database**: Connected and all queries working
3. **Core Features**:
   - Create new class (admin)
   - End class (admin) - works on second click
   - Student check-in
   - View check-ins (admin)
   - Basic UI with visible buttons

### 🔧 Known Issues to Fix

#### 1. OAuth State Cookie Warning (Low Priority)
**Error**: `State cookie was missing` appears in terminal
**Impact**: Non-blocking, sign-in still works
**Location**: Terminal logs during OAuth callback
**Possible fix**: Cookie configuration may need adjustment for production

#### 2. End Class Button Requires Double-Click (Medium Priority)
**Issue**: First click succeeds (200 status) but UI shows error, second click shows error (500)
**Root Cause**: After ending class once, duration is updated, so subsequent checks fail (class already ended)
**Location**: `pages/api/admin/end-class-early.ts` lines 31-34
**Fix Needed**: Better state management or UI feedback

#### 3. UI Needs Complete Redesign (High Priority)
**Current State**: Functional but basic, white background, minimal styling
**Desired State**: Modern UI similar to Lovable design at https://lovable.dev/projects/f97395e3-dd9d-4224-85b8-c09012621b99
**Key Missing Features**:
   - Chat interface on the right side
   - Better visual hierarchy
   - More polished dashboard
   - Responsive design
   - Better color scheme

## How to Run

### Prerequisites
- Docker Desktop running
- Node.js and Yarn installed
- PostgreSQL on port 5432 (via Docker)

### Startup Steps

**Terminal 1: Start Docker Services**
```bash
cd C:\Users\Alicia\Documents\bu26\Research\CheckHen
docker compose up db socket
```

**Terminal 2: Start Next.js Dev Server**
```bash
cd checkhen
yarn dev
```

Visit: http://localhost:3000

### First Time Setup
If database is empty, run migrations:
```bash
cd checkhen
npx prisma migrate deploy
```

## Testing

### Admin View
Sign in with: `alicja@bu.edu`, `langd0n@bu.edu`, or `aploog@bu.edu`
- Should redirect to `/admin/dashboard`
- Can start/end classes
- Can view check-ins and hand raises

### Student View
Sign in with any other `@bu.edu` email
- Stays on `/` (check-in page)
- Can check in to active class
- Can raise hand and chat

### Test Page (No Auth Required)
Visit: http://localhost:3000/student-test
- Simulates student view
- Can test check-in without second account

## Git Branch

**Branch**: `aliciaauthjsmigration`
**Status**: Committed locally, needs push to remote
**Commit Message**: "feat: migrate from Clerk to Auth.js with Google OAuth"

To push (when credentials are configured):
```bash
git push -u origin aliciaauthjsmigration
```

## Dependencies

### Added
- `next-auth@4.24.11` - Authentication
- `@babel/runtime@^7.28.4` - Runtime helpers

### Removed
- `@clerk/nextjs` - Old auth system
- `tailwindcss` - Conflicted with Mantine
- `autoprefixer` - Tailwind dependency
- `postcss` - Tailwind dependency (Mantine has its own)

### Key Dependencies (Unchanged)
- `next@15.1.5` - Framework
- `@mantine/core@7.16.3` - UI components
- `@prisma/client@6.3.1` - Database ORM
- `react@19.0.0` - Frontend
- `socket.io-client@4.8.1` - WebSocket for chat

## Next Steps for UI Redesign

Based on the Lovable design reference, implement:

1. **Layout**
   - Split screen: Main content left, chat right
   - Fixed header with user info
   - Sidebar navigation (if needed)

2. **Admin Dashboard**
   - Card-based layout for class info
   - Real-time check-in count
   - Hand raise queue with visual indicators
   - Integrated chat panel

3. **Student View**
   - Clean check-in interface
   - Mood selector
   - Visual feedback for check-in status
   - Chat interface

4. **Color Scheme**
   - Modern gradient backgrounds
   - Better contrast
   - Consistent blue theme from Mantine

5. **Components to Create/Update**
   - ChatPanel component (right sidebar)
   - ClassCard component
   - CheckInCard component
   - HandRaiseQueue component

## Important Notes

- **Don't reinstall Tailwind** - It conflicts with Mantine
- **Database credentials** - Must match Docker
- **OAuth redirect URIs** - Already configured in Google Cloud Console
- **Socket server** - May still expect clerk_id, needs verification
- **Admin emails** - Hardcoded in .env, not in database

## Contact

Project: CheckHen - BU Classroom Management
User: Alicia (alicja@bu.edu)
Tech Stack: Next.js 15, Prisma, PostgreSQL, Mantine UI, Auth.js
