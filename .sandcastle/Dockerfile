FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Playwright browsers in a shared path readable by any user (the install
# runs as root here, but the container runs as "agent" — without this ENV
# the browsers land in /root/.cache and agents reinstall them every
# sandbox). Version pinned to the repo's installed @playwright/test so the
# browser build revision matches; --with-deps covers the system libraries.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright@1.61.1 install --with-deps chromium && chmod -R a+rX /ms-playwright

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# prd/008 R8: the releaser runs the full `npm run validate` gate inside this
# sandbox, and its step 8 is `cargo check` in src-tauri — so the image needs
# the system libraries the Tauri crates' build scripts probe via pkg-config
# (the gate never runs `tauri build`, so dev headers are all it takes).
RUN apt-get update && apt-get install -y \
  pkg-config \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev \
  && rm -rf /var/lib/apt/lists/*

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# prd/008 R8: rustup stable for `cargo check` (validate step 8). Installed as
# the agent user so the toolchain lands in /home/agent/.rustup; validate.mjs
# already prepends ~/.cargo/bin to PATH, and the ENV below covers direct use.
RUN curl --proto '=https' --tlsv1.2 -fsSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable

# Add Claude and cargo to PATH
ENV PATH="/home/agent/.local/bin:/home/agent/.cargo/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
