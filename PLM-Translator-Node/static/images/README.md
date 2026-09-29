# DataNub Logo

## Current Status
A placeholder SVG logo (`datanub-logo.svg`) has been created for the DN Translator application.

## To Use the Official DataNub Logo
Replace the `datanub-logo.svg` file with the official DataNub logo image:

1. Save your official logo as `datanub-logo.png` (or any common image format)
2. Place it in this directory: `static/images/`
3. Update the image references in the HTML templates if using a different format:
   - `templates/translator.html`
   - `templates/mass_translation.html`
   - `templates/test_results.html`

## Image Requirements
- Recommended size: 200x50 pixels (or similar aspect ratio)
- Formats supported: PNG, JPG, SVG
- The current templates use a white filter for the logo to match the navbar background
- Adjust the CSS `filter` property if needed for your logo

## Current References
The logo is referenced in the navbar of all templates with:
```html
<img src="{{ url_for('static', filename='images/datanub-logo.svg') }}" 
     alt="DataNub" 
     height="40" 
     class="me-2" 
     style="filter: brightness(0) invert(1);">
```
