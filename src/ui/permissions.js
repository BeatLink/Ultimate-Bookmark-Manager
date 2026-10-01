// Optional permissions, asked for at the moment a feature first needs them.

// Asks for an optional permission; must be the first thing a click does, or Firefox refuses to ask.
export const askPermission = (permission) => browser.permissions.request({ permissions: [permission] }).catch(() => false);

// Asks for access to every website, which loading bookmarked pages needs; false when the user says no.
export const askAllSites = () => browser.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
