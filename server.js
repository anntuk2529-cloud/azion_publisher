const API = "https://api.azion.com/v4";
const GITHUB_API = "https://api.github.com";

function env(name, required = true) {
  const value = Azion.env.get(name);

  if (required && !value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }

  return value;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
    },
  });
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45);
}

async function azionRequest(path, options = {}) {
  const token = env("AZION_TOKEN");

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Azion API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function githubRequest(path, options = {}) {
  const token = env("GITHUB_TOKEN");

  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function createGitHubRepository(repoName) {
  const owner = env("GITHUB_OWNER");
  const isPrivate = env("GITHUB_PRIVATE", false) === "true";

  try {
    const existing = await githubRequest(
      `/repos/${owner}/${repoName}`,
      {
        method: "GET",
      }
    );

    return existing;
  } catch {
    // Repositório não existe: cria abaixo.
  }

  return githubRequest("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: repoName,
      description: `Site publicado pelo Azion Publisher`,
      private: isPrivate,
      auto_init: true,
    }),
  });
}

async function publishToGitHub(repoName, html) {
  const owner = env("GITHUB_OWNER");

  const repo = await createGitHubRepository(repoName);

  let sha;

  try {
    const current = await githubRequest(
      `/repos/${owner}/${repoName}/contents/index.html`,
      {
        method: "GET",
      }
    );

    sha = current.sha;
  } catch {
    // index.html ainda não existe.
  }

  const content = btoa(unescape(encodeURIComponent(html)));

  const payload = {
    message: "Publish site",
    content,
    branch: repo.default_branch || "main",
  };

  if (sha) {
    payload.sha = sha;
  }

  await githubRequest(
    `/repos/${owner}/${repoName}/contents/index.html`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );

  return {
    repository: repo.html_url,
    owner,
    name: repoName,
  };
}

async function createAzionBucket(bucketName, html) {
  await azionRequest("/workspace/storage/buckets", {
    method: "POST",
    body: JSON.stringify({
      name: bucketName,
      workloads_access: "read_only",
    }),
  });

  await azionRequest(
    `/workspace/storage/buckets/${encodeURIComponent(
      bucketName
    )}/objects/index.html`,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
      },
      body: html,
    }
  );

  return bucketName;
}

async function createApplication(name) {
  const result = await azionRequest(
    "/edge_application/applications",
    {
      method: "POST",
      body: JSON.stringify({
        name,
      }),
    }
  );

  return result.data || result;
}

async function createWorkload(name, domain) {
  const result = await azionRequest(
    "/workspace/workloads",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        active: true,
        infrastructure: 1,
        protocols: {
          http: {
            versions: ["http1", "http2"],
          },
        },
        tls: {
          certificate: null,
          ciphers: 7,
          minimum_version: "tls_1_3",
        },
        domains: [domain],
        workload_domain_allow_access: true,
      }),
    }
  );

  return result.data || result;
}

async function createWorkloadDeployment(workloadId, applicationId) {
  const result = await azionRequest(
    `/workspace/workloads/${workloadId}/deployments`,
    {
      method: "POST",
      body: JSON.stringify({
        name: `Deployment ${workloadId}`,
        current: true,
        active: true,
        strategy: {
          type: "default",
          attributes: {
            edge_application: applicationId,
          },
        },
      }),
    }
  );

  return result.data || result;
}

async function createStorageConnector(name, bucketName) {
  const result = await azionRequest(
    "/edge_connector/connectors",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        active: true,
        type: "edge_storage",
        attributes: {
          bucket: bucketName,
          prefix: "/",
        },
      }),
    }
  );

  return result.data || result;
}

async function createConnectorRule(applicationId, connectorId) {
  const result = await azionRequest(
    `/edge_application/applications/${applicationId}/request_rules`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Serve site from Object Storage",
        active: true,
        criteria: [
          {
            conditional: "if",
            variable: "${uri}",
            operator: "starts_with",
            argument: "/",
          },
        ],
        behaviors: [
          {
            type: "set_edge_connector",
            attributes: {
              value: connectorId,
            },
          },
        ],
      }),
    }
  );

  return result.data || result;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        status: "online",
        service: "azion_publisher",
      });
    }

    if (request.method !== "POST" || url.pathname !== "/publish") {
      return json(
        {
          error: "Not found",
        },
        404
      );
    }

    try {
      const publisherSecret = env("PUBLISHER_SECRET");
      const receivedSecret =
        request.headers.get("x-publisher-secret");

      if (!receivedSecret || receivedSecret !== publisherSecret) {
        return json(
          {
            error: "Unauthorized",
          },
          401
        );
      }

      const body = await request.json();

      const siteName = body.siteName;
      const html = body.html;

      if (!siteName || !html) {
        return json(
          {
            error: "siteName e html são obrigatórios",
          },
          400
        );
      }

      const slug = slugify(siteName);

      if (!slug) {
        return json(
          {
            error: "siteName inválido",
          },
          400
        );
      }

      const suffix = Date.now().toString(36);

      const repoName = `${slug}-${suffix}`;
      const bucketName = `site-${slug}-${suffix}`;
      const applicationName = `site-${slug}-${suffix}`;
      const workloadName = `site-${slug}-${suffix}`;

      const domainSuffix =
        env("AZION_DOMAIN_SUFFIX", false) || "azion.app";

      const domain = `${slug}-${suffix}.${domainSuffix}`;

      // 1. Salva o site no GitHub.
      const github = await publishToGitHub(repoName, html);

      // 2. Cria o bucket Azion.
      await createAzionBucket(bucketName, html);

      // 3. Cria Application.
      const application = await createApplication(
        applicationName
      );

      const applicationId =
        application.id || application.application_id;

      if (!applicationId) {
        throw new Error(
          `Azion não retornou application ID: ${JSON.stringify(
            application
          )}`
        );
      }

      // 4. Cria Workload.
      const workload = await createWorkload(
        workloadName,
        domain
      );

      const workloadId =
        workload.id || workload.workload_id;

      if (!workloadId) {
        throw new Error(
          `Azion não retornou workload ID: ${JSON.stringify(
            workload
          )}`
        );
      }

      // 5. Vincula Workload à Application.
      await createWorkloadDeployment(
        workloadId,
        applicationId
      );

      // 6. Cria Connector apontando para o bucket.
      const connector = await createStorageConnector(
        `connector-${slug}-${suffix}`,
        bucketName
      );

      const connectorId = connector.id;

      if (!connectorId) {
        throw new Error(
          `Azion não retornou connector ID: ${JSON.stringify(
            connector
          )}`
        );
      }

      // 7. Faz a Application usar o Connector.
      await createConnectorRule(
        applicationId,
        connectorId
      );

      return json({
        success: true,
        siteName,
        slug,

        url: `https://${domain}/`,

        github: {
          repository: github.repository,
        },

        azion: {
          applicationId,
          workloadId,
          connectorId,
          bucket: bucketName,
          domain,
        },
      });
    } catch (error) {
      console.error(error);

      return json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Erro interno",
        },
        500
      );
    }
  },
};
