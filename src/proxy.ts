import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const CUSTOMER_COOKIE_NAME = "manna_token";
const ADMIN_COOKIE_NAME = "manna_admin_token";
const ADMIN_CSRF_COOKIE_NAME = "manna_admin_csrf";

const ADMIN_TOKEN_SCOPE = "MANNA_ADMIN_ACCESS";
const ADMIN_TOKEN_ISSUER = "manna";
const ADMIN_TOKEN_AUDIENCE = "manna-admin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isBypassedApiRoute(pathname: string) {
  if (pathname === "/api/webhooks/kwik") return true;
  if (pathname === "/api/webhooks/paystack") return true;
  if (pathname === "/api/cron/kwik-sync") return true;
  if (pathname === "/api/cron/kwik-status-sync") return true;

  if (
    pathname.startsWith("/api/orders/") &&
    pathname.endsWith("/tracking")
  ) {
    return true;
  }

  return false;
}

function isConsolePageRoute(pathname: string) {
  return (
    pathname === "/admin/api-console" ||
    pathname.startsWith("/admin/api-console/")
  );
}

function isConsoleApiRoute(pathname: string) {
  return pathname.startsWith("/api/internal/api-console");
}

function isPublicAdminRoute(pathname: string) {
  return (
    pathname === "/admin/api-console/login" ||
    pathname === "/api/internal/api-console/auth/login" ||
    pathname === "/api/admin/auth/login"
  );
}

function isProtectedAdminRoute(pathname: string) {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/internal") ||
    pathname.startsWith("/api/debug")
  );
}

function isAdminMutation(req: NextRequest) {
  return (
    req.nextUrl.pathname.startsWith("/api/admin") &&
    !isPublicAdminRoute(req.nextUrl.pathname) &&
    !SAFE_METHODS.has(req.method.toUpperCase())
  );
}

function isCustomerAuthRoute(pathname: string) {
  return (
    pathname.startsWith("/api/orders") ||
    pathname.startsWith("/api/me") ||
    pathname.startsWith("/api/my") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/orders")
  );
}

async function verifyCustomerToken(token: string) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }

  const key = new TextEncoder().encode(secret);

  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
  });

  return {
    userId: typeof payload.sub === "string" ? payload.sub : null,
    role: typeof payload.role === "string" ? payload.role : null,
  };
}

async function verifyAdminToken(token: string) {
  const secret = process.env.MANNA_ADMIN_JWT_SECRET;

  if (!secret) {
    throw new Error("MANNA_ADMIN_JWT_SECRET is not set");
  }

  const key = new TextEncoder().encode(secret);

  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
    issuer: ADMIN_TOKEN_ISSUER,
    audience: ADMIN_TOKEN_AUDIENCE,
  });

  if (
    typeof payload.sub !== "string" ||
    payload.role !== "ADMIN" ||
    payload.scope !== ADMIN_TOKEN_SCOPE ||
    typeof payload.csrf !== "string" ||
    payload.csrf.length < 32
  ) {
    return null;
  }

  return {
    userId: payload.sub,
    role: "ADMIN" as const,
    csrfToken: payload.csrf,
  };
}

function clearAdminSession(response: NextResponse) {
  response.cookies.set(ADMIN_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
  });

  response.cookies.set(ADMIN_CSRF_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
  });

  return response;
}

function redirectToCustomerLogin(req: NextRequest, clearCookie = false) {
  const url = new URL("/login", req.url);

  url.searchParams.set(
    "next",
    `${req.nextUrl.pathname}${req.nextUrl.search}`
  );

  const response = NextResponse.redirect(url);

  if (clearCookie) {
    response.cookies.set(CUSTOMER_COOKIE_NAME, "", {
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

function redirectToAdminLogin(req: NextRequest, clearCookie = false) {
  const url = new URL("/admin/api-console/login", req.url);

  url.searchParams.set(
    "next",
    `${req.nextUrl.pathname}${req.nextUrl.search}`
  );

  const response = NextResponse.redirect(url);

  return clearCookie ? clearAdminSession(response) : response;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }

  if (isBypassedApiRoute(pathname)) {
    return NextResponse.next();
  }

  if (isPublicAdminRoute(pathname)) {
    return NextResponse.next();
  }

  if (
    isConsolePageRoute(pathname) ||
    isConsoleApiRoute(pathname) ||
    isProtectedAdminRoute(pathname)
  ) {
    const adminToken = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

    if (!adminToken) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { message: "Admin authentication required" },
          { status: 401 }
        );
      }

      return redirectToAdminLogin(req);
    }

    try {
      const adminSession = await verifyAdminToken(adminToken);

      if (!adminSession) {
        throw new Error("Invalid admin session");
      }

      if (isAdminMutation(req)) {
        const csrfCookie =
          req.cookies.get(ADMIN_CSRF_COOKIE_NAME)?.value;
        const csrfHeader =
          req.headers.get("x-manna-admin-csrf");

        if (
          !csrfCookie ||
          !csrfHeader ||
          csrfCookie !== csrfHeader ||
          csrfCookie !== adminSession.csrfToken
        ) {
          return NextResponse.json(
            { message: "Admin CSRF validation failed" },
            { status: 403 }
          );
        }
      }

      return NextResponse.next();
    } catch {
      if (pathname.startsWith("/api/")) {
        return clearAdminSession(
          NextResponse.json(
            { message: "Admin authentication required" },
            { status: 401 }
          )
        );
      }

      return redirectToAdminLogin(req, true);
    }
  }

  if (
    pathname.startsWith("/agent-login") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/api/auth")
  ) {
    return NextResponse.next();
  }

  const needsCustomerAuth = isCustomerAuthRoute(pathname);

  if (!needsCustomerAuth) {
    return NextResponse.next();
  }

  const customerToken = req.cookies.get(CUSTOMER_COOKIE_NAME)?.value;

  if (!customerToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    return redirectToCustomerLogin(req);
  }

  try {
    await verifyCustomerToken(customerToken);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );

      response.cookies.set(CUSTOMER_COOKIE_NAME, "", {
        path: "/",
        maxAge: 0,
      });

      return response;
    }

    return redirectToCustomerLogin(req, true);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
