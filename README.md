# Invoice Ninja for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration that brings your
[Invoice Ninja](https://invoiceninja.com) 5 (self-hosted, or the hosted invoicing.co) into Gladys:
unpaid and overdue invoices, money received this month and pending quotes, with scene triggers, a
scene action and a dashboard widget.

It only reads: the integration never writes to your invoices. Not affiliated with Invoice Ninja.

## Features

- **Device** for the company of the API token: unpaid invoices (count and amount), overdue invoices
  (count and amount), paid this month, pending quotes, with history.
- **Dashboard widget** "Invoice Ninja overview": totals, the overdue invoices with their days late
  and the latest payments (10 rows at most); every block, and the amounts, can be hidden.
- **Scene triggers**: payment received, invoice overdue, quote accepted (approved or converted).
- **Scene action**: read the summary, as a sentence to send or read aloud, with its numbers.
- Amounts converted to the currency of the company with the exchange rates Invoice Ninja records.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- Invoice Ninja 5 reachable from the Gladys host, or an invoicing.co account whose plan includes the
  API, and an API token (Settings → Account Management → API Tokens). Invoice Ninja 4 is not
  supported.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-invoiceninja` (or install it from the catalog once it is listed).
2. In **Configuration**, enter the address of Invoice Ninja (`https://invoicing.co` for the hosted
   service) and the API token, then save. **Test the connection** checks them.
3. Open the **Discover** tab and add the company.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

Every 15 minutes by default (5 to 60), the container reads the
[Invoice Ninja v5 API](https://invoiceninja.github.io/docs/api-reference/invoice-ninja-api-reference)
with six requests: the current company, the unpaid invoices, the payments of the month, the latest
payments, the number of pending quotes and the latest accepted quotes. Deleted records and those of
deleted clients are left out, as in the dashboard of Invoice Ninja. The device is published with
`should_poll: false` and its own timer; only the values that changed are sent, and re-sent every 12
hours. What the triggers already told (ids only) is kept under `/data`, so a restart fires nothing
twice, and what exists at the first reading is never news.

Invoices are private: the logs never hold an amount, a client name, the token or the address of the
server, even at debug level.

## Limitations

- Read only; one company per token.
- Six requests per reading: keep a reasonable interval on invoicing.co, which throttles its API.
- A trigger is noticed at the next reading (up to one interval later).
- Developed and tested against a real self-hosted Invoice Ninja 5.13 in Docker (fictitious clients,
  invoices, payments and quotes created through its API), not on invoicing.co nor on a Gladys
  installation with real invoices: feedback welcome.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and a fake Invoice Ninja serving the answers
recorded on a real Invoice Ninja 5.13 (`test/fixtures/invoiceninja`, made-up company and clients).
See [`CLAUDE.md`](CLAUDE.md) for the rules of the project.

## Credits

- [Invoice Ninja](https://github.com/invoiceninja/invoiceninja) by Invoice Ninja LLC and its
  contributors: its API, and the table of its currency ids (`src/currencies.js`, from its
  `/api/v1/statics`). The filters and currency conversions mirror its own code
  (`app/Filters/*`, `app/Services/Chart/ChartQueries.php`); no code is copied.
- Cover: the Invoice Ninja logo (`public/images/new_logo.png` of its official repository), enlarged on a
  light background.
- Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and
  the official JavaScript template.

## License

[Apache 2.0](LICENSE).
