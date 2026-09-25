# Community avatar gallery

This directory is the curated, same-origin avatar library shown by
WebComicChat's **Community Avatars…** dialog. It is separate from Microsoft's
original characters.

To publish an avatar:

1. Confirm that WebComicChat has permission to redistribute it and record its
   creator and source.
2. Add a version 2 Comic Chat `.avb` file here. Files must be no larger than 2
   MB and must contain a character, not a backdrop.
3. Add one entry to `catalog.json`. `id` and `announcementName` must contain
   only letters, numbers, underscores, or hyphens. `file` must be a filename in
   this directory, without a path.
4. Run the normal tests and build. The browser fully decodes and validates each
   file before its **Use avatar** button is enabled.

Do not add arbitrary remote URLs. The build bundles these files onto
webcomicchat.com so IRC appearance announcements remain same-origin and users
cannot turn the client into a remote-file downloader.
