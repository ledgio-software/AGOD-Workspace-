# Backend - AGOD Project & Payout Tracker

## Overview
This is the backend/database layer for the AGOD Internal Project & Payout Tracker system.

## Technology Stack
- **Database:** PostgreSQL (Supabase)
- **Authentication:** Supabase Auth
- **Storage:** Supabase Storage
- **Migrations:** Supabase CLI / SQL migrations
- **API:** Next.js API routes (in frontend) + Supabase client SDK
- **Real-time:** Supabase Realtime (optional)

## Database Architecture

### Core Tables
- `users` - Team members with roles and permissions
- `projects` - Project definitions and lifecycle tracking
- `project_assignments` - Team assignments and compensation splits
- `milestones` - Project milestones
- `tasks` - Individual tasks with status tracking
- `compensation_snapshots` - Immutable compensation records at approval
- `compensation_snapshot_lines` - Individual payout calculations
- `payout_ledger_entries` - Payout tracking and status
- `payment_transactions` - Manual payment records
- `adjustments` - Payout adjustments and corrections
- `audit_events` - Complete audit trail
- `notifications` - In-app notifications

### Key Features
- **Row Level Security (RLS)** - User-level access control
- **Transactions** - Atomic operations for financial data
- **Immutability** - Financial records are append-only
- **Audit Trail** - Every material action is logged
- **Money Handling** - Integer minor units (pesewas) with currency codes

## Project Structure
```
backend/
├── supabase/
│   ├── migrations/           # Database migrations
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_rls_policies.sql
│   │   └── ...
│   ├── functions/           # Edge functions (optional)
│   ├── seed.sql            # Seed data for development
│   └── config.toml         # Supabase configuration
├── scripts/                # Utility scripts
│   ├── backup.sh
│   ├── restore.sh
│   └── seed-dev.js
├── docs/                   # Database documentation
│   ├── schema.md
│   ├── rls-policies.md
│   └── queries.md
└── README.md
```

## Getting Started

### Prerequisites
- Supabase CLI installed
- PostgreSQL knowledge
- Access to Supabase project

### Installation
```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to project
supabase link --project-ref your-project-ref
```

### Database Migrations
```bash
# Create new migration
supabase migration new migration_name

# Apply migrations locally
supabase db reset

# Apply migrations to remote
supabase db push

# View migration status
supabase migration list
```

### Local Development
```bash
# Start local Supabase
supabase start

# View local dashboard
# Studio: http://localhost:54323

# Stop local Supabase
supabase stop
```

## Schema Overview

### Users & Authentication
```sql
users (
  id UUID PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  role user_role (TEAM_MEMBER, PROJECT_MANAGER, ADMIN),
  active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

### Projects
```sql
projects (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT,
  description TEXT,
  client_type client_type (INTERNAL, EXTERNAL),
  total_value_minor INTEGER,
  currency CHAR(3),
  status project_status,
  project_owner_id UUID REFERENCES users,
  approved_by UUID REFERENCES users,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

### Compensation & Payouts
```sql
compensation_snapshots (
  id UUID PRIMARY KEY,
  project_id UUID UNIQUE REFERENCES projects,
  project_total_value_minor INTEGER,
  currency CHAR(3),
  created_by UUID REFERENCES users,
  created_at TIMESTAMPTZ
)

payout_ledger_entries (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects,
  member_id UUID REFERENCES users,
  amount_owed_minor INTEGER,
  amount_paid_minor INTEGER,
  currency CHAR(3),
  status payout_status,
  approved_by UUID REFERENCES users,
  created_at TIMESTAMPTZ
)
```

## Row Level Security (RLS)

### Key Policies
```sql
-- Team members see only their own records
CREATE POLICY "team_member_own_records" ON payout_ledger_entries
  FOR SELECT USING (auth.uid() = member_id);

-- Project Managers see all records
CREATE POLICY "pm_all_records" ON payout_ledger_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('PROJECT_MANAGER', 'ADMIN')
    )
  );

-- Only admins can void payouts
CREATE POLICY "admin_void_payouts" ON payout_ledger_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role = 'ADMIN'
    )
  );
```

## Money Handling Rules

### Storage Format
- All amounts stored as **integer minor units** (pesewas for GHS)
- Example: GHS 100.50 = 10050 pesewas
- Currency code stored alongside every amount (ISO 4217)

### Calculations
```sql
-- Percentage split
raw_amount = (total_value_minor * percentage) / 100
rounded_amount = ROUND(raw_amount)

-- Fixed split
amount = fixed_value_minor
```

### Validation
- Percentage splits must total exactly 100%
- Fixed splits cannot exceed project value
- Payment amounts cannot exceed owed amounts (without adjustment)
- All calculations are deterministic and auditable

## Approval Workflow

### Atomic Transaction
```sql
BEGIN;
  -- Lock project
  SELECT * FROM projects WHERE id = $1 FOR UPDATE;
  
  -- Validate state
  -- Create compensation snapshot
  -- Generate payout ledger entries
  -- Update project status
  -- Create audit event
COMMIT;
```

## Backup & Recovery

### Daily Backups
Supabase provides automatic daily backups. Verify backup status in dashboard.

### Manual Backup
```bash
# Export database
supabase db dump -f backup.sql

# Restore database (CAUTION)
supabase db reset --db-url postgresql://...
```

### Point-in-Time Recovery
Available on Supabase Pro plan and above.

## Security Best Practices

1. **Never expose service role key** in client code
2. **Use RLS policies** for all tables with user data
3. **Validate inputs** on both client and database level
4. **Audit all financial operations** in audit_events table
5. **Encrypt sensitive data** at rest and in transit
6. **Rotate credentials** when team members leave
7. **Review RLS policies** regularly
8. **Test backup/restore** procedures quarterly

## Common Queries

### Outstanding Payouts by Member
```sql
SELECT 
  u.name,
  u.email,
  SUM(p.amount_owed_minor - p.amount_paid_minor) as outstanding_minor,
  p.currency
FROM payout_ledger_entries p
JOIN users u ON u.id = p.member_id
WHERE p.status IN ('OWED', 'PARTIALLY_PAID')
GROUP BY u.id, u.name, u.email, p.currency;
```

### Project Payout Summary
```sql
SELECT 
  proj.code,
  proj.name,
  COUNT(p.id) as recipient_count,
  SUM(p.amount_owed_minor) as total_owed,
  SUM(p.amount_paid_minor) as total_paid,
  proj.currency
FROM projects proj
JOIN payout_ledger_entries p ON p.project_id = proj.id
GROUP BY proj.id, proj.code, proj.name, proj.currency;
```

## Monitoring & Maintenance

### Database Health
- Monitor connection pool usage
- Check slow query logs
- Review index performance
- Monitor storage usage

### Audit Log Retention
- Keep audit_events indefinitely for financial records
- Archive old notifications after 90 days
- Soft delete completed projects (never hard delete)

## Testing

### Migration Testing
```bash
# Test migrations locally
supabase db reset
supabase migration up

# Verify schema
supabase db diff
```

### Data Validation
```bash
# Run validation scripts
npm run validate:schema
npm run validate:rls
npm run validate:calculations
```

## Contributing

### Adding Migrations
1. Create migration: `supabase migration new feature_name`
2. Write SQL with rollback plan
3. Test locally: `supabase db reset`
4. Review RLS implications
5. Document changes
6. Submit PR

### Migration Guidelines
- **Never modify** existing migrations
- **Always include** rollback strategy
- **Test with real data** volumes
- **Consider performance** impact
- **Update documentation** immediately

## Troubleshooting

### Connection Issues
```bash
# Check Supabase status
supabase status

# Verify connection
psql $DATABASE_URL
```

### RLS Debugging
```sql
-- Test as specific user
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user-uuid"}';
```

## Documentation
- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [RLS Best Practices](https://supabase.com/docs/guides/auth/row-level-security)

## License
Internal use only - AGOD Software Solutions

---

**For database questions or access requests, contact the AGOD Admin team.**
