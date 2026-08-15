export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        JSON.stringify({
          status: "online",
          service: "azion_publisher",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
        }
      );
    }

    if (request.method === "POST" && url.pathname === "/publish") {
      try {
        const body = await request.json();

        const { siteName, html } = body;

        if (!siteName || !html) {
          return new Response(
            JSON.stringify({
              error: "siteName e html são obrigatórios",
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json; charset=UTF-8",
              },
            }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            siteName,
            message: "Endpoint de publicação funcionando.",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=UTF-8",
            },
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Erro interno",
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=UTF-8",
            },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: "Not found",
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json; charset=UTF-8",
        },
      }
    );
  },
};
