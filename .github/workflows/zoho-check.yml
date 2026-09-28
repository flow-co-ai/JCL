name: Zoho check
on:
  workflow_dispatch:
    inputs:
      script:
        description: Which check to run
        type: choice
        options: [money, fields]
        default: money
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Check Zoho (read-only)
        run: |
          if [ "${{ inputs.script }}" = "money" ]; then node scripts/zoho-money.mjs; else node scripts/zoho-check.mjs; fi
        env:
          ZOHO_CLIENT_ID: ${{ secrets.ZOHO_CLIENT_ID }}
          ZOHO_CLIENT_SECRET: ${{ secrets.ZOHO_CLIENT_SECRET }}
          ZOHO_REFRESH_TOKEN: ${{ secrets.ZOHO_REFRESH_TOKEN }}
