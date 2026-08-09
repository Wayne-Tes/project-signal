import type { HelpArticle } from '../types';

/**
 * Reporting, administration, and the assistant.
 *
 * The roles table is taken from `UserRole` in apps/api/src/plugins/auth.ts. The assistant
 * article states its limits plainly — read-only, tenant-scoped, cites what it used — because a
 * user who does not know an assistant's boundaries will either over-trust it or not use it.
 */
export const REPORTING_ADMIN: HelpArticle[] = [
  {
    slug: 'weekly-report',
    title: 'The weekly report',
    category: 'reporting',
    summary: 'What the printable report contains and how to produce a PDF.',
    keywords: ['report', 'pdf', 'print', 'weekly', 'export', 'download', 'share'],
    view: 'report',
    related: ['understanding-the-index', 'brand-impact-explained'],
    body: `
**Weekly report** is a printable summary of where the brand stands: the index, the five
dimensions, the leading Brand impact subjects and the suggested actions.

## Producing a PDF

Open the report and choose **Download PDF** in the top bar. This uses your browser's print
dialogue — choose "Save as PDF" as the destination. The page is styled for print, so the sidebar,
top bar and any interactive controls are omitted automatically.

## What it is for

It is designed to be **read by someone who does not use the product** — a board paper, a
stakeholder update. It states the numbers and the reasons behind them without requiring the
reader to navigate anything.

If you need the underlying signals rather than the summary, use the drill-down instead: **Dig
into score** traces any number down to the individual things people said.
`.trim(),
  },

  {
    slug: 'action-roadmap-explained',
    title: 'The action roadmap',
    category: 'reporting',
    summary: 'Suggested actions, how they are prioritised, and what the expected impact figure means.',
    keywords: ['roadmap', 'actions', 'recommendations', 'priority', 'what should i do', 'impact'],
    view: 'roadmap',
    related: ['brand-impact-explained'],
    body: `
**Action roadmap** turns the Brand impact findings into a prioritised list of things to do.

## How items are prioritised

Each item carries a priority and an expected impact. Both derive from the damage score of the
subject the action addresses — see [Brand impact](/help/brand-impact-explained). An action against
a large, recent, very negative cluster ranks above one against a small or fading cluster.

## Reading the expected impact

The impact figure is an **estimate of how much of the current damage the action addresses**, not a
promise about the index. Because of the 90-day half-life, resolving a problem does not remove the
signals about it — newer signals gradually outweigh them. Expect movement over weeks.

## Using it

Treat the ranking as a starting point rather than an instruction. The roadmap knows what people
are saying; it does not know what is cheap for you to change, what is already underway, or what
is outside your control. The value is in the ordering and the reasoning, both of which trace back
to real signals you can read.
`.trim(),
  },

  {
    slug: 'roles-and-permissions',
    title: 'Roles and permissions',
    category: 'administration',
    summary: 'The three roles, what each can do, and why a role change can take up to an hour.',
    keywords: ['roles', 'permissions', 'admin', 'owner', 'user', 'access', 'cannot see', 'denied'],
    related: ['inviting-users', 'tenants-and-isolation'],
    body: `
There are three roles.

| Role | Can do |
| --- | --- |
| **User** | View every analytical view for their tenant's brands |
| **Admin** | Everything a user can, plus manage brands, sources, aliases and users |
| **Owner** | Everything an admin can, plus create tenants |

**Owner** is a platform-level role, not a customer-facing one. In normal use a customer
organisation has admins and users.

## Why a role change is not instant

Your role is carried in your **sign-in token**, not read from the database on each request. When
an admin changes your role, your existing token still says what it said when it was issued.

**Sign out and back in** to pick up a change immediately. Otherwise it takes effect when your
token next refreshes, which can be up to an hour.

If you have just been given access to something and still see "not permitted", this is almost
always why.
`.trim(),
  },

  {
    slug: 'inviting-users',
    title: 'Adding users',
    category: 'administration',
    summary: 'How to add someone to your tenant and give them the right role.',
    keywords: ['user', 'add user', 'invite', 'team', 'colleague', 'account', 'new person'],
    related: ['roles-and-permissions', 'tenants-and-isolation'],
    body: `
Admins and owners can add users from **Admin**.

A new user is created against your tenant with the role you choose. They can only ever see brands
belonging to that tenant — see [Tenants and data isolation](/help/tenants-and-isolation).

## Choosing a role

Give **user** unless the person needs to change configuration. The difference that matters is
that admins can add sources and aliases, and both of those silently change what the index is
measuring — a bad alias pollutes the score without producing an error anywhere.

## After adding someone

They sign in with their own credentials. If they were already a user of another tenant, note that
roles and access are per tenant, not global.
`.trim(),
  },

  {
    slug: 'tenants-and-isolation',
    title: 'Tenants and data isolation',
    category: 'administration',
    summary: 'What a tenant is, and the guarantee that one tenant never sees another tenant’s data.',
    keywords: ['tenant', 'isolation', 'security', 'separate', 'other customers', 'privacy', 'data'],
    related: ['roles-and-permissions'],
    body: `
A **tenant** is one customer organisation. Every brand, signal, score and user belongs to exactly
one tenant.

## The guarantee

Every query in the product is filtered by tenant, and brand-scoped views additionally check that
the brand belongs to your tenant. You cannot see another tenant's data, and no setting, link or
identifier you can type will change that — your tenant is taken from your verified sign-in token,
never from anything supplied by the page.

This applies to the assistant too. It can only read what you can read.

## Within a tenant

Isolation is **between** tenants. Within your tenant, a user can see all of that tenant's brands.
If you need people to see different brands, that is a product request rather than a setting.
`.trim(),
  },

  {
    slug: 'using-the-assistant',
    title: 'Using the assistant',
    category: 'getting-started',
    summary:
      'What the in-product assistant can and cannot do, how to ask it good questions, and how to check its answers.',
    keywords: [
      'assistant',
      'chat',
      'ai',
      'ask',
      'question',
      'bot',
      'help me',
      'citations',
      'sources',
    ],
    related: ['tenants-and-isolation', 'understanding-the-index'],
    body: `
The assistant is available from every view. Ask it a question in plain language and it will answer
from **your** data and from this help centre.

## What it can do

- Read your brands, scores, dimension breakdowns, Brand impact subjects, strengths and individual
  signals
- Explain what a number means and how it was produced
- Compare periods, brands and competitors
- Point you at the right part of the product

## What it cannot do

- **It cannot change anything.** It is strictly read-only: it cannot add a source, edit an alias,
  change a role or delete a signal. If you ask it to, it will tell you where to do it yourself.
- **It cannot see other tenants.** It reads exactly what you can read, through the same
  permission checks — see [Tenants and data isolation](/help/tenants-and-isolation).
- **It cannot see anything outside the product.** No web search, no internal systems.

## Checking its answers

Answers carry **citations**. Each one points at the actual record used — a score, a subject, a
signal, or a help article — and you can open it. If a claim has no citation, treat it as
background rather than as fact about your data.

This is the honest position: the assistant is a fast way to find and summarise things you could
have found yourself, and the citations are how you confirm it did.

## Asking better questions

Vague questions get vague answers. Compare:

- *"How are we doing?"* → a summary of the headline number
- *"Which dimension fell most in the last month, and what subject is driving it?"* → a specific
  answer with the signals behind it

It knows what is on your screen, so "explain this" works.
`.trim(),
  },
];
