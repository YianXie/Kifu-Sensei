# Privacy Policy

**Effective date:** [Jul 23, 2026]
**Last updated:** [Jul 23, 2026]

This policy explains what data Kifu-Sensei collects, why, and what you can do about it. It covers the website at kifu-sensei.ai and the Kifu-Sensei Chrome extension.

Kifu-Sensei is operated by Yian Xie ("we", "us"). You can reach us at yianxie52@gmail.com.

---

## The short version

- We collect your email address, your Go games, and — if you provide one — your AI provider credential.
- Your API key is encrypted before it is stored, and we never send it back to your browser.
- We do not sell your data, run advertising, or track you across the web.
- Your games are sent to KataGo and the AI provider you configure in order to generate commentary. A local provider endpoint may keep that processing on your own network.
- You can delete your account and everything in it at any time.

---

## 1. What we collect

### Account information

When you register we store:

- Your email address
- A hashed password (we never store your password in readable form)
- Account creation and activity timestamps

We use this to authenticate you, to keep your review history attached to your account, and to contact you about your account if necessary.

### Your AI provider credential

Kifu-Sensei generates commentary using the AI provider you configure. The supported provider modes are Claude and OpenAI-compatible endpoints. Azure OpenAI requires a separate adapter and is not included in the current provider modes.

If you choose to provide your own provider credential:

- We do not require a provider-specific key prefix. Local OpenAI-compatible endpoints may use an arbitrary credential or no credential.
- We encrypt it before writing it to our database. The plaintext key is never stored.
- We never return the credential to your browser or extension after you save it. Our API only reports whether a credential is present, not what it is.
- We decrypt it only at the moment we make a commentary request on your behalf.
- You can remove it at any time from your account settings, which deletes it from our database.

We do not use your credential for anything other than generating commentary that you requested.

### Go game data

To produce commentary we process:

- SGF files you upload to the web app
- Game data read from online-go.com pages you open while using the extension, including moves, board size, komi, result, and player rank
- The commentary generated from that data

We store this so you can revisit past reviews. We store this indefinitely until you delete it.

We do not scrape online-go.com in the background. The extension only reads a game when you have that game open and have asked for commentary.

### Extension-specific data

The extension stores your authentication tokens in your browser's local extension storage so you stay signed in. This stays on your device. Signing out removes it.

The extension requests the following browser permissions:

- **storage** — to keep your session on your device
- **sidePanel** — to display the commentary panel
- **activeTab / tabs** — to detect when you are on a game page and to open sign-in pages
- **scripting** — to clear your session from open Kifu-Sensei tabs when you sign out
- **host access to online-go.com and kifu-sensei.ai** — the only sites the extension runs on

The extension does not read, record, or transmit your browsing activity on any other site.

### Technical logs

Our servers record standard request logs: IP address, timestamp, requested endpoint, response status, and user agent. We use these to diagnose errors and detect abuse. Logs are retained for 30 days.

### Analytics

We do not use analytics, advertising, or third-party tracking of any kind.

---

## 2. What we do not collect

- We do not collect your name, address, or payment details.
- We do not use tracking cookies or advertising pixels.
- We do not build advertising profiles.
- We do not sell, rent, or trade your personal information to anyone, for any purpose.

---

## 3. Who we share data with

We share data only with the service providers we need to run the product:

| Provider                                    | What they receive                                                       | Why                             |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| Your configured AI provider                  | Board positions, engine statistics, and prompts derived from your games | To generate the commentary text |
| Amazon Web Services, for your KataGo server | Board positions from your games                                         | To run engine analysis          |
| Render                                      | Application and database hosting; all stored data                       | Hosting                         |
| Cloudflare                                  | Network traffic, IP addresses                                           | Routing, TLS, abuse protection  |

Board positions sent for analysis are game data. They do not include your email address or your account identity.

We may also disclose data if legally compelled to do so, or where necessary to investigate abuse or protect the safety of our users. If we are legally permitted to notify you first, we will.

If Kifu-Sensei is ever acquired or merged, your data may transfer to the new operator. We will notify you before that happens and before this policy changes as a result.

---

## 4. Where data is stored

Our servers and database are hosted in the United States (Oregon). If you use Kifu-Sensei from outside that region, your data is transferred and processed there.

---

## 5. How long we keep it

- **Account data** — until you delete your account.
- **Games and commentary** — until you delete them individually or delete your account.
- **API keys** — until you remove the key or delete your account.
- **Server logs** — 30 days.

When you delete your account, we remove your account record, your stored API key, and your saved games from our production database within 30 days. Encrypted backups may retain copies for up to 30 days before rotating out.

---

## 6. Security

- Passwords are hashed; we cannot read them.
- API keys are encrypted at rest using symmetric encryption, with the encryption key held outside the database.
- All traffic is served over HTTPS.
- Sessions use short-lived access tokens with separate refresh tokens.

No system is perfectly secure, and we cannot promise that it is. If we discover a breach affecting your personal data, we will notify affected users at the email address on your account, without undue delay.

---

## 7. Your rights

Regardless of where you live, you can:

- **Access** the data we hold about you
- **Correct** inaccurate account information
- **Delete** your account and its contents from your settings page
- **Export** your games and commentary
- **Withdraw** your API key at any time

To exercise any of these, use your account settings or email yianxie52@gmail.com. We aim to respond within 7 days.

### If you are in the EU/UK

You additionally have the right to object to processing, to request restriction of processing, to data portability, and to lodge a complaint with your local supervisory authority. Our legal basis for processing is performance of our contract with you (providing the service you signed up for) and our legitimate interest in keeping the service secure and functional.

### If you are in California

We do not sell or share personal information as those terms are defined under the CCPA/CPRA, and we have not done so in the preceding twelve months. You have the right to know, delete, correct, and to be free from discrimination for exercising those rights.

---

## 8. Children

Kifu-Sensei is not directed at children under 13, and we do not knowingly collect personal information from them. If you believe a child has created an account, contact us at yianxie52@gmail.com and we will delete it.

---

## 9. Changes to this policy

We will post any changes on this page and update the "last updated" date. If a change materially affects how we handle your data, we will notify you by email before it takes effect.

---

## 10. Contact

yianxie52@gmail.com
