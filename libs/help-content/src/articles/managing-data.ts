import type { HelpArticle } from '../types';

/**
 * Sources, aliases and competitors.
 *
 * The source list is taken from the `SignalSource` union in `libs/shared-types`, and the
 * distinction between "a source the product models" and "a source with a working adapter" is
 * stated explicitly — quietly listing nine and shipping five is how a user concludes the product
 * is broken when it is merely incomplete.
 */
export const MANAGING_DATA: HelpArticle[] = [
  {
    slug: 'adding-a-source',
    title: 'Adding a data source',
    category: 'managing-data',
    summary:
      'How to connect a source to a brand, which sources are available, and what happens after you add one.',
    keywords: ['source', 'add source', 'feed', 'rss', 'connect', 'integration', 'data', 'configure'],
    view: 'admin',
    related: ['available-sources', 'name-aliases', 'why-is-my-dashboard-empty'],
    body: `
Sources are configured per brand, by an admin or owner.

## Adding one

1. Go to **Admin**.
2. Under **Manage brand**, pick the brand.
3. Under **Sources**, choose a source type and provide its address — for RSS, the feed URL.
4. Select **Add**.

## What happens next

Nothing immediately visible. Sources are polled **on a schedule**, not when you add them, and a
newly added source only starts contributing from its next collection run. After that, signals
have to be scored and rolled up before the dashboard changes — see
[Why is my dashboard empty?](/help/why-is-my-dashboard-empty).

## Before you add one

**Check the address actually works.** A feed URL that returns 404 produces no signals, and there
is no error on your dashboard telling you so — you simply get nothing, which is easy to mistake
for "nobody is talking about us".

**Check your aliases first.** Signals are matched to your brand by name. A perfect source
produces nothing if the way people write your name is not recorded — see
[Name aliases](/help/name-aliases).
`.trim(),
  },

  {
    slug: 'available-sources',
    title: 'Which sources are available',
    category: 'managing-data',
    summary:
      'The source types the product models, and which of them currently have a working collector.',
    keywords: [
      'sources',
      'google reviews',
      'trustpilot',
      'youtube',
      'app store',
      'play store',
      'rss',
      'news',
      'twitter',
      'x',
      'survey',
      'supported',
    ],
    related: ['adding-a-source'],
    body: `
Project Signal models ten source types. **Not all of them have a working collector yet**, and the
difference matters: configuring a source with no collector produces no signals and no warning.

## Sources with a working collector

| Source | Notes |
| --- | --- |
| **RSS** | Any valid feed URL. The most flexible option and the one with fewest dependencies. |
| **Google Reviews** | Location reviews. |
| **App Store** | iOS app reviews. |
| **Play Store** | Android app reviews. |
| **YouTube** | Video and comment signals. |
| **Reddit** | Unprompted conversation — the one source that reads places you do not control. |

## Recognised, but not available

**Trustpilot**, **News API**, **X** and **Survey** appear in the product's data model, but no
collector exists for them. They are **not offered** when you add a source, and the API refuses
them — so you cannot end up with a source that looks configured and quietly collects nothing.

If you need one of these, that is a product request rather than a configuration problem.

## Choosing sources

More sources is not automatically better. Every source has its own population — app store reviews
skew toward people with a specific complaint, RSS toward press coverage — and adding a
high-volume source changes what the index is measuring. If your index shifts sharply after adding
a source, that is usually the composition changing rather than perception changing.
`.trim(),
  },

  {
    slug: 'name-aliases',
    title: 'Name aliases — making sure you are found',
    category: 'managing-data',
    summary:
      'Signals are matched to your brand by name. Aliases cover the abbreviations, misspellings and old names people actually use.',
    keywords: ['alias', 'aliases', 'name', 'matching', 'abbreviation', 'spelling', 'not matching', 'missing signals'],
    related: ['adding-a-source', 'why-is-my-dashboard-empty'],
    body: `
A signal is attached to your brand by matching the text against your brand's name and its
**aliases**. If people write about you in a way you have not recorded, those signals are not
counted.

## Adding an alias

1. **Admin** → **Manage brand** → pick the brand.
2. Under **Name aliases**, add the variant.

## What to add

- **Abbreviations and initialisms** — "TES" for "Tes Global"
- **Common misspellings** — the ones you actually see, not every theoretical one
- **Former names**, and names from acquisitions people still use
- **Product names** that carry the brand, if coverage of the product is coverage of you
- **Spacing and punctuation variants** — "ProjectSignal", "Project-Signal"

## What not to add

**Anything ambiguous.** An alias that also means something else pulls in unrelated signals, and
those get scored and counted like any other. A brand called "Orange" adding the alias "orange"
will find itself being judged on fruit.

Aliases are cheap to add and their cost is invisible — a bad one quietly pollutes your index
rather than producing an error. When in doubt, add the specific form rather than the general one.
`.trim(),
  },

  {
    slug: 'competitors',
    title: 'Tracking competitors',
    category: 'managing-data',
    summary: 'How competitor brands work, and why their scores are and are not comparable to yours.',
    keywords: ['competitor', 'competitors', 'benchmark', 'compare', 'rivals', 'market'],
    view: 'competitors',
    related: ['understanding-the-index', 'adding-a-source'],
    body: `
A competitor is a brand entity in your tenant marked as **not owned**. It is scored by exactly the
same pipeline as your own brand, and appears on the **Competitors** view.

## Setting one up

An admin creates the brand entity, then configures sources and aliases for it just as for your
own brand. A competitor with no sources has no score — the comparison is only as good as the
collection behind it.

## Reading the comparison honestly

**Compare movements, not absolute values.** Two brands rarely have comparable source mixes. If
you collect app store reviews and they do not, you are measuring different populations, and the
gap between the two numbers is partly an artefact of that.

What *is* comparable is direction. Both brands are scored by the same model with the same decay,
so "we rose and they fell over the same period" is a real observation even when the levels are
not directly comparable.

## A caution

Competitor scores are only as current as the sources you have configured for them. A competitor
whose collection is thinner than yours will look more stable simply because fewer signals are
moving the number.
`.trim(),
  },
  {
    slug: 'where-to-point-it',
    title: 'Where to point it — finding real sources for your brand',
    category: 'managing-data',
    summary:
      'You do not enter individual reviews. You enter the ADDRESS of a place people are already talking, and this is how to find each kind of address.',
    keywords: [
      'where',
      'which sources',
      'what url',
      'example',
      'find sources',
      'google news',
      'app id',
      'channel id',
      'place id',
      'package name',
      'subreddit',
      'no signals',
      'nothing collected',
      'empty dashboard',
      'get started',
      'set up',
      'point the platform',
    ],
    related: ['adding-a-source', 'available-sources', 'why-is-my-dashboard-empty'],
    body: `
You do not add reviews. You add the **address of a place people are already talking**, and the
platform reads that place on a schedule. Each source type wants a different kind of address, and
finding the right one is where most empty dashboards come from.

The single most useful thing to know first: **RSS is not just for blogs.** A Google News search
URL is an RSS feed, and it is the highest-volume source most brands have. One feed per product,
per brand name, or per phrase you care about.

## News and press coverage — RSS

Take any Google News search and add \`/rss/\` to it:

\`\`\`
https://news.google.com/rss/search?q=%22Your+Brand%22&hl=en-GB&gl=GB&ceid=GB:en
\`\`\`

- \`%22...%22\` is a quoted phrase. **Quote it.** Without quotes, "Class Charts" matches any page
  containing both words and you will collect noise.
- \`hl=en-GB&gl=GB&ceid=GB:en\` asks for UK results. Change for another market — and add a second
  feed rather than replacing the first, if you care about both.
- One feed **per product**, not one for the company. That is what makes the product-level index
  mean anything.

Open the URL in a browser before you add it. If it loads but contains no \`<item>\` elements, the
feed is empty — and an empty feed and a dead brand look identical on a dashboard.

Publisher feeds work the same way: most news sites expose \`/feed/\` or \`/rss\`. Some block
automated readers with a 403, which shows up as a failed feed rather than an empty one.

## App reviews — App Store and Play Store

**App Store** wants the numeric id from the store URL:

\`\`\`
https://apps.apple.com/gb/app/some-app/id1018656220
                                        ^^^^^^^^^^ this part, without "id"
\`\`\`

Set the country to the store you want. Each territory is a separate review population, so a
separate feed per market is usually right.

**Play Store** wants the package name from its URL:

\`\`\`
https://play.google.com/store/apps/details?id=com.example.app
                                              ^^^^^^^^^^^^^^^
\`\`\`

A common mistake is pasting the whole URL into the field. Paste only the identifier.

## Video — YouTube

YouTube wants a **channel id**, which starts \`UC\` — not the \`@handle\` URL. To find it, open the
channel, view source, and search for \`externalId\`; or use any "YouTube channel ID finder". A
handle URL in this field produces \`YouTube search failed: 400\`, which is the API rejecting it
rather than the channel being empty.

## Locations — Google Reviews

Wants a **Place ID**, which looks like \`ChIJ...\`. Google's own Place ID Finder will give you one
for any address. This is worth adding per site if you have physical locations; it is not useful
for a purely digital product.

## Unprompted conversation — Reddit

The others read places you control or invite comment on. Reddit reads conversation you are not
part of, which is often the most honest signal you have.

- **Quote the phrase.** Reddit's search is fuzzy: an unquoted \`ClassCharts\` returns posts from
  unrelated subreddits that merely resemble the word.
- **Scope to a subreddit** when you know where your audience is — it turns a noisy search into a
  precise one.
- Leave the subreddit empty to search all of Reddit, and expect to refine the phrase.

## If you have added sources and still see nothing

Work down this list in order:

1. **Check each feed's status in Admin.** A feed that failed says so, in red, with the reason.
   "never run" means it has genuinely never been attempted; a red failure means it was attempted
   and rejected, and the message says by what.
2. **Check your name aliases.** Signals are matched by name. If people write "Tes" and your only
   alias is "Tes Global", a perfect feed collects nothing.
3. **Check the feed itself in a browser.** A URL that returns a page but no items is the most
   common cause of silence, and nothing about it looks broken.
4. **Give it a scan and a rollup.** Collection is on a schedule, and scores appear only after the
   next rollup — so a source added a minute ago is expected to show nothing yet.
`.trim(),
  },
];
