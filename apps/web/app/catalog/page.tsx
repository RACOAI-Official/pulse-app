"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Archive, FileUp, PackagePlus, RefreshCw, Trash2, X } from "@/components/icons";
import WorkspaceShell from "@/components/WorkspaceShell";
import { api } from "@/lib/api";
import { CommerceConfig, Currency, decimal, money, Product, toMinor } from "@/lib/commerce";

type MediaRef = { path: string } | { url: string };
type EditImage = { key: string; media: MediaRef; preview: string };
// SKU and options are kept for existing variants but no longer edited; the API generates SKUs for new ones.
type EditVariant = { id?: string; sku: string; options: Record<string, string>; regular: string; offer: string; stock: string };
type EditProduct = { id?: string; title: string; category: string; description: string; images: EditImage[]; delivery: string; state: "draft" | "active"; variants: EditVariant[] };
const MAX_IMAGES = 20;
const emptyVariant = (): EditVariant => ({ sku: "", options: {}, regular: "0.00", offer: "", stock: "0" });
const emptyProduct = (): EditProduct => ({ title: "", category: "", description: "", images: [], delivery: "", state: "draft", variants: [emptyVariant()] });
const mediaKey = (media: MediaRef) => "path" in media ? media.path : media.url;
const columns = "product_key,title,category,description,sku,options,regular_price,offer_price,stock,image_urls,delivery_charge\n";

function CatalogContent({ tenantId, role }: { tenantId: string; role: "owner" | "manager" | "staff" }) {
  const base = `/tenants/${tenantId}/commerce`;
  const [config, setConfig] = useState<CommerceConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EditProduct | null>(null);
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<{ sha256: string; product_count: number; variant_count: number; errors: { row: number; error: string }[] } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [stockEdit, setStockEdit] = useState<{ variant: string; delta: string; reason: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [scrollTick, setScrollTick] = useState(0);
  const editorRef = useRef<HTMLElement>(null);
  const objectUrls = useRef(new Set<string>());

  useEffect(() => {
    if (scrollTick) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollTick]);
  useEffect(() => {
    const urls = objectUrls.current;
    return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);
  function startEditing(product: EditProduct) { setEditing(product); setScrollTick(tick => tick + 1); }
  function closeEditor() {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear();
    setEditing(null);
  }

  const refresh = useCallback(async () => {
    const [settings, rows] = await Promise.all([api<CommerceConfig>(`${base}/config`), api<Product[]>(`${base}/products`)]);
    setConfig(settings); setProducts(rows);
  }, [base]);
  useEffect(() => { refresh().catch(error => setNotice(error.message)); }, [refresh]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice("");
    try { await work(); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  };
  function openProduct(product: Product) {
    const images = product.media.map(media => ({ key: mediaKey(media), media, preview: "url" in media ? media.url : "" }));
    startEditing({ id: product.id, title: product.title, category: product.category,
      description: product.description, images,
      delivery: decimal(product.delivery_minor), state: product.state === "active" ? "active" : "draft",
      variants: product.product_variants.filter(v => v.active).map(v => ({ id: v.id, sku: v.sku, options: v.options,
        regular: decimal(v.regular_price_minor), offer: decimal(v.offer_price_minor), stock: String(v.stock) })) });
    // Stored uploads are private; fetch short-lived links for the thumbnails.
    for (const image of images) {
      if (!("path" in image.media)) continue;
      api<{ url: string }>(`${base}/media/sign?path=${encodeURIComponent(image.media.path)}`).then(({ url }) =>
        setEditing(current => current && current.id === product.id ? { ...current, images: current.images.map(item => item.key === image.key ? { ...item, preview: url } : item) } : current)
      ).catch(() => {});
    }
  }
  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await run(async () => {
      await api(`${base}/products`, { method: "POST", body: JSON.stringify({
        id: editing.id, title: editing.title.trim(),
        category: editing.category, description: editing.description,
        media: editing.images.map(image => image.media),
        delivery_minor: editing.delivery ? toMinor(editing.delivery) : null, state: editing.state,
        variants: editing.variants.map(v => ({ id: v.id, sku: v.sku, options: v.options,
          regular_price_minor: toMinor(v.regular), offer_price_minor: v.offer ? toMinor(v.offer) : null,
          stock: Number(v.stock) })),
      }) });
      closeEditor(); setNotice("Product saved.");
    });
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const room = MAX_IMAGES - (editing?.images.length || 0) - uploading;
    const files = Array.from(input.files || []).slice(0, Math.max(room, 0));
    input.value = "";
    if (!files.length || !editing) { if (room <= 0) setNotice(`At most ${MAX_IMAGES} images per product.`); return; }
    setNotice(""); setUploading(count => count + files.length);
    await Promise.all(files.map(async file => {
      try {
        const result = await api<{ path: string }>(`${base}/media`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        const preview = URL.createObjectURL(file);
        objectUrls.current.add(preview);
        setEditing(current => current ? { ...current, images: [...current.images, { key: result.path, media: { path: result.path }, preview }] } : current);
      } catch (error) {
        setNotice(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
      } finally { setUploading(count => count - 1); }
    }));
  }
  function removeImage(key: string) {
    setEditing(current => {
      if (!current) return current;
      const image = current.images.find(item => item.key === key);
      if (image && objectUrls.current.delete(image.preview)) URL.revokeObjectURL(image.preview);
      return { ...current, images: current.images.filter(item => item.key !== key) };
    });
  }
  async function loadCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvText(await file.text()); setPreview(null);
  }
  async function previewCsv() {
    await run(async () => {
      const result = await api<typeof preview>(`${base}/csv/preview`, { method: "POST", body: JSON.stringify({ csv_text: csvText }) });
      setPreview(result);
    });
  }
  const shown = products.filter(p => `${p.title} ${p.category}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="commerce-page">
    <header className="commerce-heading catalog-heading"><div><h1>Catalog</h1><p>Manage products, variants, images, and available stock.</p></div><button className="button primary" onClick={() => startEditing(emptyProduct())}><PackagePlus size={16} /> Add product</button></header>
    {notice && <p className="form-notice" role="status">{notice}</p>}
    <div className="catalog-overview">
    <section className="commerce-card catalog-list"><div className="commerce-section-head"><div><h2>Products <span className="count-pill">{products.length}</span></h2><p>Drafts stay hidden from order creation.</p></div><input aria-label="Search products" placeholder="Search catalog" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="commerce-list">{shown.map(product => <article className="commerce-row" key={product.id}><div className="commerce-row-main"><strong>{product.title}</strong><small>{product.category || "Uncategorized"}</small><span className={`commerce-state ${product.state}`}>{product.state}</span></div><div className="commerce-row-meta"><strong>{product.product_variants.filter(v => v.active).length} variants</strong><small>{product.product_variants.reduce((total, v) => total + v.stock, 0)} units, {money(Math.min(...product.product_variants.map(v => v.offer_price_minor ?? v.regular_price_minor)), config?.currency || "BDT")} from</small></div><button className="button subtle" onClick={() => openProduct(product)}>Edit</button>{product.state === "archived" ? <button className="button subtle" disabled={busy} onClick={() => run(async () => { await api(`${base}/products/${product.id}/restore`, { method: "POST" }); })}><RefreshCw size={14} /> Restore</button> : <button className="button subtle" disabled={busy} title="Delete if unused, archive if ordered" onClick={() => { if (window.confirm(`Remove ${product.title}? Unused products are deleted; ordered products are archived.`)) run(async () => { await api(`${base}/products/${product.id}/remove`, { method: "POST" }); }); }}><Archive size={14} /> Remove</button>}</article>)}
        {!shown.length && <p className="commerce-empty">No products match this search.</p>}</div>
    </section>
    <section className="commerce-card commerce-config catalog-currency"><div><h2>Store currency</h2><p>Prices use one currency across this workspace. It locks after the first product or order.</p></div>
      <select aria-label="Store currency" value={config?.currency || "BDT"} disabled={!config || config.currency_locked || role !== "owner" || busy} onChange={event => run(async () => { await api(`${base}/currency`, { method: "POST", body: JSON.stringify({ currency: event.target.value }) }); })}>
        {(["BDT", "USD", "EUR", "GBP"] as Currency[]).map(value => <option key={value}>{value}</option>)}
      </select></section>
    </div>
    {editing && <section ref={editorRef} className="commerce-card commerce-editor"><div className="commerce-section-head"><div><h2>{editing.id ? "Edit product" : "New product"}</h2><p>Save as draft until an image and prices are ready.</p></div><button className="button subtle" onClick={closeEditor}>Close</button></div>
      <form onSubmit={saveProduct}><div className="commerce-form-grid"><label>Title<input required maxLength={160} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label><label>Category<input value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} /></label><label>Delivery charge ({config?.currency})<input inputMode="decimal" placeholder="Optional" value={editing.delivery} onChange={e => setEditing({ ...editing, delivery: e.target.value })} /></label><label className="wide">Description<textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label><div className="wide product-images"><span>Photos ({editing.images.length}/{MAX_IMAGES})</span><div className="media-grid">{editing.images.map((image, index) => <figure className="media-thumb" key={image.key}>{image.preview ? <img src={image.preview} alt={`Product photo ${index + 1}`} /> : <span className="media-thumb-loading">Loading…</span>}{index === 0 && <figcaption>Cover</figcaption>}<button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => removeImage(image.key)}><X size={14} /></button></figure>)}{Array.from({ length: uploading }, (_, i) => <figure className="media-thumb" key={`uploading-${i}`}><span className="media-thumb-loading">Uploading…</span></figure>)}{editing.images.length + uploading < MAX_IMAGES && <label className="media-add"><PackagePlus size={20} /><span>Add photos</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={upload} /></label>}</div><small>JPEG, PNG or WebP. The first photo is the cover. Active products need at least one.</small></div><label>Status<select value={editing.state} onChange={e => setEditing({ ...editing, state: e.target.value as "draft" | "active" })}><option value="draft">Draft</option><option value="active">Active</option></select></label></div>
        <h3>{editing.variants.length > 1 ? "Variants" : "Price & stock"}</h3>{editing.variants.map((variant, index) => <div className="variant-editor" key={variant.id || index}>{Object.keys(variant.options).length > 0 && <strong className="variant-label">{Object.values(variant.options).join(" / ")}</strong>}<label>Regular price<input required inputMode="decimal" value={variant.regular} onChange={e => setEditing({ ...editing, variants: editing.variants.map((v, i) => i === index ? { ...v, regular: e.target.value } : v) })} /></label><label>Offer price<input inputMode="decimal" value={variant.offer} onChange={e => setEditing({ ...editing, variants: editing.variants.map((v, i) => i === index ? { ...v, offer: e.target.value } : v) })} /></label>{!variant.id && <label>Initial stock<input type="number" min="0" value={variant.stock} onChange={e => setEditing({ ...editing, variants: editing.variants.map((v, i) => i === index ? { ...v, stock: e.target.value } : v) })} /></label>}{variant.id && <button type="button" className="button subtle" onClick={() => setStockEdit({ variant: variant.id!, delta: "", reason: "" })}>Stock: {variant.stock}</button>}{editing.variants.length > 1 && <button type="button" className="button subtle" onClick={() => setEditing({ ...editing, variants: editing.variants.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>}</div>)}
        <div className="commerce-actions"><button className="button primary" disabled={busy || uploading > 0}>{uploading ? "Uploading photos…" : "Save product"}</button></div></form>
    </section>}
    {stockEdit && <section className="commerce-card"><h2>Adjust stock</h2><p>Enter a positive amount to add units or a negative amount to remove them.</p><form className="commerce-inline" onSubmit={event => { event.preventDefault(); run(async () => { await api(`${base}/variants/${stockEdit.variant}/stock`, { method: "POST", body: JSON.stringify({ delta: Number(stockEdit.delta), reason: stockEdit.reason }) }); setStockEdit(null); }); }}><input type="number" required value={stockEdit.delta} onChange={e => setStockEdit({ ...stockEdit, delta: e.target.value })} placeholder="Units (+/-)" /><input required value={stockEdit.reason} onChange={e => setStockEdit({ ...stockEdit, reason: e.target.value })} placeholder="Reason" /><button className="button primary" disabled={busy}>Apply</button><button type="button" className="button subtle" onClick={() => setStockEdit(null)}>Cancel</button></form></section>}
    <section className="commerce-card"><div className="commerce-section-head"><div><h2>CSV import</h2><p>Preview every row before importing. Any error stops the whole import.</p></div><a className="button subtle" href={`data:text/csv;charset=utf-8,${encodeURIComponent(columns)}`} download="pulse-products-template.csv"><FileUp size={15} /> Template</a></div><div className="commerce-inline"><input type="file" accept=".csv,text/csv" aria-label="Choose CSV file" onChange={loadCsv} /><button className="button subtle" disabled={!csvText || busy} onClick={previewCsv}>Preview</button>{preview && !preview.errors.length && <button className="button primary" disabled={busy} onClick={() => run(async () => { await api(`${base}/csv/commit`, { method: "POST", body: JSON.stringify({ csv_text: csvText, sha256: preview.sha256 }) }); setCsvText(""); setPreview(null); setNotice("CSV imported."); })}>Import {preview.product_count} products</button>}</div>{preview && <p className="commerce-preview">{preview.product_count} products, {preview.variant_count} variants, {preview.errors.length} errors</p>}{preview?.errors.map(error => <p className="error-text" key={`${error.row}-${error.error}`}>Row {error.row}: {error.error}</p>)}</section>
  </main>;
}

export default function CatalogPage() {
  return <WorkspaceShell>{workspace => <CatalogContent key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
