# Frontend - AGOD Project & Payout Tracker

## Overview
This is the frontend application for the AGOD Internal Project & Payout Tracker system.

## Technology Stack
- **Framework:** Next.js 14+ with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Forms:** React Hook Form + Zod validation
- **State Management:** React Context / Zustand (as needed)
- **API Integration:** Next.js API routes / Server Actions
- **Authentication:** Supabase Auth
- **Testing:** Vitest, React Testing Library, Playwright

## Project Structure
```
frontend/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (auth)/            # Authentication pages
│   │   ├── (authenticated)/   # Protected routes
│   │   │   ├── dashboard/
│   │   │   ├── projects/
│   │   │   ├── ledger/
│   │   │   ├── team/
│   │   │   └── my-work/
│   │   └── api/               # API routes
│   ├── components/            # React components
│   │   ├── ui/               # shadcn/ui components
│   │   ├── forms/
│   │   ├── layouts/
│   │   └── features/
│   ├── lib/                   # Utility functions
│   │   ├── supabase/
│   │   ├── validation/
│   │   └── utils/
│   ├── hooks/                 # Custom React hooks
│   ├── types/                 # TypeScript types
│   └── styles/                # Global styles
├── public/                    # Static assets
├── tests/                     # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── package.json
```

## Getting Started

### Prerequisites
- Node.js 18+ and npm/pnpm/yarn
- Supabase account and project
- Environment variables configured

### Installation
```bash
cd frontend
npm install
```

### Environment Variables
Create a `.env.local` file:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### Build
```bash
npm run build
npm run start
```

### Testing
```bash
# Run unit tests
npm run test

# Run E2E tests
npm run test:e2e

# Type checking
npm run type-check

# Linting
npm run lint
```

## Key Features

### For Team Members
- View assigned projects and tasks
- Update task status with completion notes
- Track personal work history
- View payout records and payment status
- In-app notifications

### For Project Managers
- Create and manage projects
- Configure team assignments and compensation splits
- Define milestones and tasks
- Approve or reject project completion
- View all project payout records
- Export ledger data

### For Admins
- Manage team members and roles
- Record manual payments
- Create payout adjustments
- View complete audit trail
- Access full system reporting

## Development Guidelines

### Code Style
- Use TypeScript strict mode
- Follow ESLint and Prettier configurations
- Use functional components with hooks
- Implement proper error boundaries

### Component Guidelines
- Keep components small and focused
- Use composition over inheritance
- Implement proper loading and error states
- Ensure accessibility (WCAG 2.1 AA)

### Form Validation
- Use Zod schemas for all forms
- Validate on both client and server
- Provide clear, actionable error messages

### Security
- Never expose service role keys in client code
- Validate all user inputs
- Use Row Level Security (RLS) policies
- Implement proper CSRF protection

## Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Environment Setup
Ensure all environment variables are configured in Vercel dashboard.

## Contributing
1. Create a feature branch from `main`
2. Follow the established code style
3. Write tests for new features
4. Submit PR for review
5. Ensure CI checks pass

## License
Internal use only - AGOD Software Solutions
