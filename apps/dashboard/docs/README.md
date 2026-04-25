# Documentation Index

Welcome to the Bail Bonds Dashboard documentation. This folder contains comprehensive guides for understanding the system architecture, data flow, and deployment procedures.

## 📚 Core Documentation

### Start Here
- **[SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)** — Overview of the entire system
  - Data sources & MongoDB collections
  - API endpoints summary
  - Technology stack (React 19, Vite, Express, Mongoose)
  - Troubleshooting guide
  
- **[FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md)** — Repository layout
  - Active vs. legacy folders
  - Which files to modify for different tasks
  - File organization by layer (frontend, backend, config)
  - Quick navigation guide

- **[DATA_FLOW.md](./DATA_FLOW.md)** — Information flow through the system
  - County data ingestion
  - API request/response patterns
  - Frontend data fetching (TanStack Query)
  - Authentication & authorization
  - CRM updates workflow

## 🔧 Integration & Technical

### Authentication
- **[authentication-integration.md](./authentication-integration.md)** — Firebase Auth setup & custom auth layer
  - Firebase SDK initialization
  - JWT token verification
  - User roles & permissions

### Enrichment System
- **[Enrichment_Wiring_Status.md](./Enrichment_Wiring_Status.md)** — Enrichment API integration status
  - DOB sweep implementation
  - Pipl subject summary
  - Current wiring status (stubs)

### Features
- **[CRM_SUBVIEWS.md](./CRM_SUBVIEWS.md)** — CRM feature architecture
- **[CRM_SUBVIEWS_COMPLETION.md](./CRM_SUBVIEWS_COMPLETION.md)** — CRM completion checklist
- **[checkins-integration-plan.md](./checkins-integration-plan.md)** — Check-ins feature plan

### Messaging & Payments
- **[messaging-sms-integration.md](./messaging-sms-integration.md)** — SMS/messaging system
- **[messaging-provider-brief.md](./messaging-provider-brief.md)** — Messaging providers overview
- **[PAYMENT_INTEGRATION_REQUIREMENTS.md](./PAYMENT_INTEGRATION_REQUIREMENTS.md)** — Payment processing
- **[payments-operations-sop.md](./payments-operations-sop.md)** — Payment operations guide
- **[payments-qa-checklist.md](./payments-qa-checklist.md)** — Payment feature QA

## 🚀 Deployment & Operations

### Containerization & DevOps
- **[deployment-containerization.md](./deployment-containerization.md)** — Docker setup
  - Local development with hotreload
  - Docker Compose configuration
  - Multi-stage builds

### CI/CD & Staging
- **[cicd-staging.md](./cicd-staging.md)** — CI/CD pipeline
  - GitHub Actions workflows
  - Staging environment setup
  - Automated testing

### Production
- **[production-deployment.md](./production-deployment.md)** — Production checklist
  - Render.io deployment
  - Environment configuration
  - Security considerations

- **[Release_Smoke_Checklist.md](./Release_Smoke_Checklist.md)** — Pre-release QA
  - Manual testing checklist
  - Smoke test procedures

## 📊 Status & Readiness

- **[final-feature-readiness.md](./final-feature-readiness.md)** — Feature completeness status
  - What's ready for production
  - What's in progress
  - What's planned

- **[Enrichment_Wiring_Status.md](./Enrichment_Wiring_Status.md)** — Enrichment system current state

## 🔐 Configuration & Credentials

- **[credentials-mapping.md](./credentials-mapping.md)** — Environment variable mappings
- **[requested_creds.md](./requested_creds.md)** — Required credentials & setup
- **[requested_creds.example.md](./requested_creds.example.md)** — Credential template

## 📁 Subfolders

### `/progress/`
Session-by-session progress notes. Track what was done, when, and by whom.

### `/changes/`
Change logs and diffs documenting significant code changes and features.

## 🔍 Quick Reference

### Common Tasks

**I want to...**

| Task | Read This | File Path |
|------|-----------|-----------|
| Understand the system | SYSTEM_ARCHITECTURE.md | `/docs/SYSTEM_ARCHITECTURE.md` |
| Find where to add code | FOLDER_STRUCTURE.md | `/docs/FOLDER_STRUCTURE.md` |
| Learn how data flows | DATA_FLOW.md | `/docs/DATA_FLOW.md` |
| Set up local development | deployment-containerization.md | `/docs/deployment-containerization.md` |
| Deploy to production | production-deployment.md | `/docs/production-deployment.md` |
| Implement authentication | authentication-integration.md | `/docs/authentication-integration.md` |
| Wire enrichment APIs | Enrichment_Wiring_Status.md | `/docs/Enrichment_Wiring_Status.md` |
| Check feature status | final-feature-readiness.md | `/docs/final-feature-readiness.md` |
| Set up credentials | requested_creds.md | `/docs/requested_creds.md` |
| Configure CI/CD | cicd-staging.md | `/docs/cicd-staging.md` |

## 🆘 Troubleshooting

**If you see...**

| Symptom | Solution | Doc |
|---------|----------|-----|
| "Firebase config is incomplete" | Check `/public/env.js` is loaded | SYSTEM_ARCHITECTURE.md → Troubleshooting |
| API returns 500 on `/api/cases` | Verify user has `cases:read` permission | SYSTEM_ARCHITECTURE.md → Troubleshooting |
| Enrichment endpoints not working | They're stubs; read wiring status | Enrichment_Wiring_Status.md |
| Docker services won't start | Check compose file and ports | deployment-containerization.md |
| Permissions denied errors | Update User model roles | SYSTEM_ARCHITECTURE.md → Troubleshooting |

## 📖 Documentation Standards

- **Markdown format**: All docs use standard Markdown
- **Code blocks**: Use syntax highlighting (```javascript, ```bash, etc.)
- **Links**: Use relative links to other docs in this folder
- **Tables**: Use Markdown tables for structured info
- **Diagrams**: Use ASCII art or text-based flowcharts

## 📝 Contributing

When adding new documentation:

1. Create a new `.md` file in the appropriate subfolder
2. Add it to this README's index
3. Use clear headings (H1, H2, H3)
4. Include examples and code snippets
5. Reference related docs with relative links
6. Update `/progress/` with what you added

## 🗓 Latest Updates

**December 8, 2025**
- Created: SYSTEM_ARCHITECTURE.md
- Created: FOLDER_STRUCTURE.md
- Created: DATA_FLOW.md
- Updated: This README

**Key changes**:
- API GET /cases endpoint now queries county collections directly (simple_harris, simple_jefferson, etc.)
- Database architecture rule established: no separate `cases` collection; live county data only
- Documentation created for understanding system flow

---

**Last updated**: December 8, 2025  
**Branch**: `feature/prospects-and-crm-ui`  
**Maintainers**: Ryan Morrow

