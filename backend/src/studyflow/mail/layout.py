"""Email-client-compatible components; plain strings are escaped on composition."""

from urllib.parse import urlsplit

from markupsafe import Markup

LIGHT = {
    "page": "#F4F5F7",
    "card": "#FFFFFF",
    "line": "#E3E5EA",
    "ink": "#191C24",
    "muted": "#4B5260",
    "faint": "#6A707C",
    "primary": "#232A38",
    "on_primary": "#FFFFFF",
    "well": "#F6F7F9",
    "ok": "#13786F",
}
DARK = {
    "page": "#111215",
    "card": "#18191D",
    "line": "#2A2C32",
    "ink": "#EEF0F3",
    "muted": "#B4B8C1",
    "faint": "#8C919B",
    "primary": "#E7E9EE",
    "on_primary": "#191C24",
    "well": "#1F2126",
    "ok": "#4FB3A8",
}
SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
DISPLAY = "'Bricolage Grotesque'," + SANS
MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"


def heading(text: str) -> Markup:
    return Markup(
        '<h1 class="sf-ink" style="margin:0;font-family:{};font-size:28px;line-height:34px;'
        'font-weight:700;letter-spacing:-0.02em;color:{};">{}</h1>'
    ).format(DISPLAY, LIGHT["ink"], text)


def paragraph(text: str, *, size: int = 16, top: int = 12) -> Markup:
    return Markup(
        '<p class="sf-muted" style="margin:{}px 0 0;font-family:{};font-size:{}px;'
        'line-height:1.6;color:{};">{}</p>'
    ).format(top, SANS, size, LIGHT["muted"], text)


def button(label: str, url: str) -> Markup:
    return Markup(
        '<div style="margin:28px 0 0;">'
        '<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{url}" '
        'style="height:48px;v-text-anchor:middle;width:240px;" arcsize="20%" stroke="f" '
        'fillcolor="{c[primary]}"><center style="color:#ffffff;font-family:Arial,sans-serif;'
        'font-size:16px;font-weight:600;">{label}</center></v:roundrect><![endif]-->'
        '<!--[if !mso]><!-- --><a class="sf-btn" href="{url}" style="display:inline-block;'
        "background:{c[primary]};color:{c[on_primary]};font-family:{sans};font-size:16px;"
        "font-weight:600;line-height:48px;padding:0 28px;border-radius:10px;"
        'text-decoration:none;mso-hide:all;">{label}</a><!--<![endif]--></div>'
    ).format(url=url, label=label, c=LIGHT, sans=SANS)


def fallback_link(url: str) -> Markup:
    return Markup(
        '<p class="sf-faint" style="margin:28px 0 6px;font-family:{sans};font-size:13px;'
        'line-height:20px;color:{c[faint]};">'
        "If the button doesn't work, paste this link into your browser:</p>"
        '<p style="margin:0;font-family:{mono};font-size:12px;line-height:18px;'
        'word-break:break-all;"><a class="sf-muted" href="{url}" '
        'style="color:{c[muted]};text-decoration:underline;">{url}</a></p>'
    ).format(url=url, c=LIGHT, sans=SANS, mono=MONO)


def render_layout(
    *, title: str, preheader: str, body: str, reason: str, public_app_url: str
) -> str:
    app_url = public_app_url.rstrip("/")
    dark = Markup("\n").join(
        Markup(".sf-{}{{{}:{}!important}}").format(cls, prop, DARK[token])
        for cls, prop, token in (
            ("page", "background", "page"),
            ("card", "background", "card"),
            ("card", "border-color", "line"),
            ("ink", "color", "ink"),
            ("muted", "color", "muted"),
            ("faint", "color", "faint"),
            ("line", "border-color", "line"),
            ("well", "background", "well"),
            ("well", "border-color", "line"),
            ("ok", "color", "ok"),
            ("btn", "background", "primary"),
            ("btn", "color", "on_primary"),
        )
    )
    return str(
        Markup("""<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{title}</title>
<style>
:root{{color-scheme:light dark;supported-color-schemes:light dark}}
body{{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%}}
a{{color:inherit}}
@media (max-width:620px){{
.sf-pad{{padding-left:24px!important;padding-right:24px!important}}
.sf-btn{{display:block!important;text-align:center!important}}
}}
@media (prefers-color-scheme:dark){{{dark}}}
</style>
</head>
<body class="sf-page" style="margin:0;padding:0;background:{c[page]};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">{preheader}
&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;
&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sf-page"
style="background:{c[page]};"><tr><td align="center" style="padding:40px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td class="sf-pad" style="padding:0 40px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;"><img src="{app_url}/brand/email-mark.png" width="28" height="28"
alt="" style="display:block;border:0;border-radius:7px;"></td>
<td class="sf-ink" style="font-family:{display};font-size:17px;font-weight:700;
letter-spacing:-0.01em;color:{c[ink]};">StudyFlow</td>
</tr></table></td></tr>
<tr><td class="sf-card sf-pad" style="background:{c[card]};border:1px solid {c[line]};
border-radius:14px;padding:40px;">{body}</td></tr>
<tr><td class="sf-pad" style="padding:24px 40px 0;">
<p class="sf-faint" style="margin:0;font-family:{sans};font-size:12px;line-height:18px;
color:{c[faint]};">{reason}</p>
<p class="sf-faint" style="margin:8px 0 0;font-family:{sans};font-size:12px;line-height:18px;
color:{c[faint]};">StudyFlow · <a class="sf-faint" href="{app_url}"
style="color:{c[faint]};">{host}</a></p>
</td></tr></table></td></tr></table>
</body></html>""").format(
            title=title,
            preheader=preheader,
            body=body,
            reason=reason,
            app_url=app_url,
            host=urlsplit(app_url).netloc,
            dark=dark,
            c=LIGHT,
            sans=SANS,
            display=DISPLAY,
        )
    )
