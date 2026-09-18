# Ordningsvakt Prep Sweden — Web

Independent public marketing and study site for the released iOS app **Ordningsvakt Prep Sweden**.

Production: <https://mcyj.github.io/ordningsvakt-prep-sweden-web/>

## Local use

```bash
npm test
python3 -m http.server 4176 --directory dist
```

Open `http://localhost:4176/ordningsvakt-prep-sweden-web/sv/` when serving through a matching Project Pages base path, or serve `dist` under that prefix.

## Content

- Swedish and English landing, FAQ, privacy, terms, support and contact pages.
- Twelve substantive study guides per locale in `content/articles.mjs`.
- Official-source verification date and links are preserved in generated pages.
- Add a locale by extending `articles`, `i18n`, `copy`, FAQ/legal copy and the `locales` list together.

## Deployment

Pushes to `main` run the build and verifier before deployment through GitHub's official Pages artifact actions.

This is an independent RushLabs study resource and is not affiliated with the Swedish Police Authority.
