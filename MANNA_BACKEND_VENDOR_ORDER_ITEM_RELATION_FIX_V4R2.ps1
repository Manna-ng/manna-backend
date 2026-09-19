$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "MANNA BACKEND VENDOR ORDER ITEM RELATION FIX V4R2 STOPPED" -ForegroundColor Red
  Write-Host "ABORTED: $Message" -ForegroundColor Red
  throw $Message
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Read-Normalized([string]$Path) {
  return ([System.IO.File]::ReadAllText($Path) -replace "`r`n", "`n")
}

Write-Host "Manna Backend - VendorOrderItem Prisma Relation Compatibility Fix V4R2" -ForegroundColor Cyan
Write-Host "Repairs the vendor orders API exposed by the build after V4R1 without changing schema/data." 
Write-Host "No database, migration execution, environment, dependency-install, or deployment mutation." 

$root = (Get-Location).Path
$routePath = Join-Path $root 'src\app\api\vendors\orders\route.ts'
$schemaPath = Join-Path $root 'prisma\schema.prisma'
$migrationsRoot = Join-Path $root 'prisma\migrations'
$packagePath = Join-Path $root 'package.json'

foreach ($required in @($routePath, $schemaPath, $packagePath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    Fail "Expected backend file not found: $required"
  }
}

Write-Host "`n==> Re-proving post-V4R1 boundary" -ForegroundColor Cyan

$expectedPreimage = @'
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAuthToken } from "@/lib/auth";
type VendorMembership={vendorId:string};
function unauthorized(){return NextResponse.json({ok:false,message:'Unauthorized'},{status:401})}
export async function GET(req:NextRequest){try{const store=await cookies();const token=store.get('manna_token')?.value;const decoded=token?verifyAuthToken(token):null;if(!decoded?.userId)return unauthorized();const url=new URL(req.url);const status=url.searchParams.get('status');const limitParam=Number(url.searchParams.get('limit')??'50');const limit=Number.isInteger(limitParam)?Math.min(Math.max(limitParam,1),100):50;const memberships=(await prisma.vendorUser.findMany({where:{userId:decoded.userId,isActive:true},select:{vendorId:true}})) as VendorMembership[];const vendorIds=memberships.map(x=>x.vendorId);if(!vendorIds.length)return NextResponse.json({ok:true,vendorOrders:[]});const vendorOrders=await prisma.vendorOrder.findMany({where:{vendorId:{in:vendorIds},...(status?{status}:{})},orderBy:{createdAt:'desc'},take:limit,include:{items:{include:{product:{select:{id:true,name:true,imageUrl:true}},productVariant:{select:{id:true,name:true,unit:true}}}}}});return NextResponse.json({ok:true,vendorOrders})}catch(error){const message=error instanceof Error?error.message:'Something went wrong';return NextResponse.json({ok:false,message},{status:400})}}
'@

$currentRoute = Read-Normalized $routePath
$expectedRoute = ($expectedPreimage -replace "`r`n", "`n").TrimEnd("`n")
$currentComparable = $currentRoute.TrimEnd("`n")
if ($currentComparable -ne $expectedRoute) {
  Fail 'Vendor orders route drifted from the exact known preimage that produced the Prisma build error. No source was changed.'
}
Write-Host '  vendor orders failing preimage: EXACT / VERIFIED'

$schema = [System.IO.File]::ReadAllText($schemaPath)
$modelMatch = [regex]::Match($schema, '(?ms)model\s+VendorPickupLocation\s*\{.*?^\}')
if (-not $modelMatch.Success) { Fail 'VendorPickupLocation model not found in Prisma schema.' }
$model = $modelMatch.Value
if ($model -notmatch '(?m)^\s*latitude\s+Float\?' -or
    $model -notmatch '(?m)^\s*longitude\s+Float\?' -or
    $model -notmatch '(?m)^\s*accuracy\s+Float\?' -or
    $model -notmatch '(?m)^\s*capturedAt\s+DateTime\?') {
  Fail 'V4R1 optional precise-location schema state is not present. No source was changed.'
}
Write-Host '  V4R1 location schema: VERIFIED'

$migrationCandidates = @()
if (Test-Path -LiteralPath $migrationsRoot -PathType Container) {
  $migrationCandidates = @(Get-ChildItem -LiteralPath $migrationsRoot -Directory | Where-Object { $_.Name -like '*_vendor_pickup_optional_precise_location' })
}
if ($migrationCandidates.Count -lt 1) {
  Fail 'Expected V4R1 vendor pickup optional-location migration artifact was not found.'
}
$migrationFiles = @($migrationCandidates | ForEach-Object { Join-Path $_.FullName 'migration.sql' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
if ($migrationFiles.Count -lt 1) {
  Fail 'V4R1 migration directory exists but migration.sql is missing.'
}
Write-Host '  V4R1 migration artifact: PRESENT / NOT EXECUTED BY THIS SCRIPT'

Write-Host "`n==> Creating guarded source backup" -ForegroundColor Cyan
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $root ".manna-backups\vendor-order-item-relation-fix-v4r2-$stamp"
$backupRoute = Join-Path $backupRoot 'src\app\api\vendors\orders\route.ts'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupRoute) | Out-Null
Copy-Item -LiteralPath $routePath -Destination $backupRoute
Write-Host "  backup: $backupRoot"

Write-Host "`n==> Repairing vendor orders response enrichment" -ForegroundColor Cyan
$newRoute = @'
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAuthToken } from "@/lib/auth";

type VendorMembership = {
  vendorId: string;
};

function unauthorized() {
  return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  try {
    const store = await cookies();
    const token = store.get("manna_token")?.value;
    const decoded = token ? verifyAuthToken(token) : null;

    if (!decoded?.userId) return unauthorized();

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limitParam = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isInteger(limitParam)
      ? Math.min(Math.max(limitParam, 1), 100)
      : 50;

    const memberships = (await prisma.vendorUser.findMany({
      where: { userId: decoded.userId, isActive: true },
      select: { vendorId: true },
    })) as VendorMembership[];

    const vendorIds = memberships.map((membership) => membership.vendorId);

    if (vendorIds.length === 0) {
      return NextResponse.json({ ok: true, vendorOrders: [] });
    }

    // VendorOrderItem stores scalar product IDs. It does not expose Prisma
    // relations named `product` / `productVariant`, so resolve display data
    // separately and enrich the response without changing financial/order rows.
    const rawVendorOrders = await prisma.vendorOrder.findMany({
      where: {
        vendorId: { in: vendorIds },
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { items: true },
    });

    const productIds = [
      ...new Set(
        rawVendorOrders.flatMap((order) =>
          order.items.map((item) => item.productId)
        )
      ),
    ];

    const productVariantIds = [
      ...new Set(
        rawVendorOrders.flatMap((order) =>
          order.items.flatMap((item) =>
            item.productVariantId ? [item.productVariantId] : []
          )
        )
      ),
    ];

    const [products, productVariants] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, imageUrl: true },
      }),
      prisma.productVariant.findMany({
        where: { id: { in: productVariantIds } },
        select: { id: true, name: true, unit: true },
      }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const productVariantById = new Map(
      productVariants.map((variant) => [variant.id, variant])
    );

    const vendorOrders = rawVendorOrders.map((order) => ({
      ...order,
      items: order.items.map((item) => ({
        ...item,
        product: productById.get(item.productId) ?? null,
        productVariant: item.productVariantId
          ? productVariantById.get(item.productVariantId) ?? null
          : null,
      })),
    }));

    return NextResponse.json({ ok: true, vendorOrders });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
'@
Write-Utf8NoBom $routePath $newRoute
Write-Host '  PATCHED    src\app\api\vendors\orders\route.ts'

Write-Host "`n==> Verifying repair invariants" -ForegroundColor Cyan
$after = Read-Normalized $routePath
if ($after -match 'items\s*:\s*\{\s*include\s*:\s*\{\s*product\s*:') {
  Fail 'Invalid VendorOrderItem product relation include still exists after patch.'
}
foreach ($requiredSnippet in @(
  'include: { items: true }',
  'prisma.product.findMany({',
  'prisma.productVariant.findMany({',
  'product: productById.get(item.productId) ?? null',
  'productVariant: item.productVariantId'
)) {
  if (-not $after.Contains($requiredSnippet)) {
    Fail "Expected vendor-order enrichment invariant missing: $requiredSnippet"
  }
}
Write-Host '  VendorOrderItem relation misuse: REMOVED'
Write-Host '  product display enrichment: PRESERVED via scalar-ID lookup'
Write-Host '  product variant display enrichment: PRESERVED via scalar-ID lookup'
Write-Host '  Prisma schema: UNCHANGED by V4R2'
Write-Host '  migration artifact: PRESERVED / NOT EXECUTED'
Write-Host '  database mutation: NOT EXECUTED'

Write-Host "`n==> Validating Prisma schema" -ForegroundColor Cyan
& npx prisma validate
if ($LASTEXITCODE -ne 0) {
  Fail "prisma validate failed: $LASTEXITCODE. Backup retained at $backupRoot"
}
Write-Host '  prisma validate: GREEN'

Write-Host "`n==> Running backend build" -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  Fail "backend build failed: $LASTEXITCODE. Do not revert V4R1 schema/migration manually; return the complete output. Backup retained at $backupRoot"
}
Write-Host '  backend build: GREEN'

Write-Host "`nManna Backend VendorOrderItem compatibility V4R2 is GREEN." -ForegroundColor Green
Write-Host 'Confirmed:'
Write-Host '  - V4R1 optional precise-location schema remains intact'
Write-Host '  - V4R1 migration artifact remains unexecuted'
Write-Host '  - vendor orders no longer assumes nonexistent VendorOrderItem relations'
Write-Host '  - product/variant display data remains available to the Vendor PWA'
Write-Host '  - no database, migration execution, environment, dependency-install, or deployment mutation occurred'
Write-Host "Backup retained at: $backupRoot"
