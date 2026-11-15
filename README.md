# Home Dashboard

Portrait-oriented household status display, deployed to Vercel from the `main` branch.

## Meal Alchemy integration

The dashboard uses a read-only server-side API to display the **active meal plan** for the configured household. It resolves titles from official, custom, and household-imported recipes, including legacy recipe IDs. It does **not** update Meal Alchemy.

### Required Vercel environment variables

Configure in **Vercel → home-dashboard → Settings → Environment Variables** for Production (and Preview if needed):

- `DASHBOARD_PASSWORD`: a long, unique shared household password.
- `SUPABASE_SERVICE_ROLE_KEY`: the legacy `service_role` JWT key from Meal Alchemy's Supabase project. **Never put this in GitHub, client-side JavaScript, or a public environment variable.**

Already configured in Vercel:

- `SESSION_SECRET`: signs the browser's HttpOnly session cookie.
- `MEALALCHEMY_HOUSEHOLD_ID`: identifies the household to read.

After setting the missing variables, **redeploy the latest `main` commit** so the deployment receives the environment variables.

The login session lasts 30 days. The `/api/meal-plan` endpoint requires a valid signed session cookie. The browser receives only the meal titles, completion flags, and plan name, not database credentials.

### Security notes

The GitHub repository is public; do not commit household secrets or private meal-plan snapshots. Keep the Vercel environment variables encrypted. The login currently has no persistent rate limiter, so use a high-entropy password and add a platform rate limit before exposing it broadly.

### Development

Static HTML/CSS/JS lives in `index.html`. Vercel Node.js functions are in `api/`. Non-meal sections currently display sample data.
