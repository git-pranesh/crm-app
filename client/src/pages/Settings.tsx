import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';

interface SLAConfig {
  rule: string;
  label: string;
  thresholdHours: number;
  updatedAt?: string;
}

interface Offer {
  id: string;
  name: string;
  description?: string;
  discountPct?: string;
  isActive: boolean;
  validFrom?: string;
  validTo?: string;
}

interface WATemplate {
  id: string;
  label: string;
  body: string;
  variables?: string[];
}

export default function Settings() {
  const [slaConfigs, setSlaConfigs] = useState<SLAConfig[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [templates, setTemplates] = useState<WATemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingHours, setEditingHours] = useState<Record<string, string>>({});
  const [savingSLA, setSavingSLA] = useState<string | null>(null);
  const [togglingOffer, setTogglingOffer] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ configs: SLAConfig[] }>('/admin/sla-config'),
      api.get<{ offers: Offer[] }>('/offers'),
      api.get<{ templates: WATemplate[] }>('/admin/whatsapp-templates'),
    ]).then(([sla, off, wa]) => {
      setSlaConfigs(sla.configs ?? []);
      setOffers(off.offers ?? []);
      setTemplates(wa.templates ?? []);
      const hrs: Record<string, string> = {};
      (sla.configs ?? []).forEach((c) => { hrs[c.rule] = String(c.thresholdHours); });
      setEditingHours(hrs);
    }).catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const saveSLA = async (rule: string) => {
    const hours = parseInt(editingHours[rule] ?? '', 10);
    if (!hours || hours < 1) { toast.error('Invalid hours'); return; }
    setSavingSLA(rule);
    try {
      const data = await api.patch<{ config: SLAConfig }>(`/admin/sla-config/${rule}`, { thresholdHours: hours });
      setSlaConfigs((prev) => prev.map((c) => c.rule === rule ? { ...c, thresholdHours: data.config.thresholdHours } : c));
      toast.success('SLA rule updated');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingSLA(null);
    }
  };

  const toggleOffer = async (id: string, isActive: boolean) => {
    setTogglingOffer(id);
    try {
      const data = await api.patch<{ offer: Offer }>(`/offers/${id}/toggle`, { isActive: !isActive });
      setOffers((prev) => prev.map((o) => o.id === id ? { ...o, isActive: data.offer.isActive } : o));
      toast.success(`Offer ${data.offer.isActive ? 'activated' : 'deactivated'}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTogglingOffer(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">SLA thresholds, active offers, and WhatsApp templates</p>
      </div>

      {/* SLA Config */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">S</span>
          SLA Rules
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rule</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Threshold</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {slaConfigs.map((cfg) => (
                <tr key={cfg.rule}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{cfg.label}</p>
                    <p className="text-xs text-gray-400 font-mono">{cfg.rule}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={editingHours[cfg.rule] ?? cfg.thresholdHours}
                        onChange={(e) => setEditingHours((h) => ({ ...h, [cfg.rule]: e.target.value }))}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                      />
                      <span className="text-xs text-gray-400">hours</span>
                      <span className="text-xs text-gray-300">
                        ({Math.round(parseInt(editingHours[cfg.rule] ?? String(cfg.thresholdHours), 10) / 24 * 10) / 10}d)
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => saveSLA(cfg.rule)}
                      disabled={savingSLA === cfg.rule || editingHours[cfg.rule] === String(cfg.thresholdHours)}
                      className="text-xs font-medium px-3 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg transition-colors"
                    >
                      {savingSLA === cfg.rule ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Offers */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">O</span>
          Offers
        </h2>
        <div className="space-y-3">
          {offers.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">
              No offers configured
            </div>
          ) : offers.map((offer) => (
            <div key={offer.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900">{offer.name}</p>
                  {offer.discountPct && (
                    <span className="text-xs font-medium bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                      {offer.discountPct}% off
                    </span>
                  )}
                </div>
                {offer.description && <p className="text-xs text-gray-500 mt-0.5">{offer.description}</p>}
                {(offer.validFrom || offer.validTo) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Valid: {offer.validFrom ? new Date(offer.validFrom).toLocaleDateString('en-IN') : '—'}
                    {' → '}
                    {offer.validTo ? new Date(offer.validTo).toLocaleDateString('en-IN') : 'ongoing'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${offer.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {offer.isActive ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => toggleOffer(offer.id, offer.isActive)}
                  disabled={togglingOffer === offer.id}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                    offer.isActive
                      ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      : 'bg-brand-500 hover:bg-brand-600 text-white'
                  } disabled:opacity-40`}
                >
                  {togglingOffer === offer.id ? '…' : offer.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* WhatsApp templates */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">W</span>
          WhatsApp Templates
        </h2>
        <p className="text-xs text-gray-400 mb-3">Pre-approved templates — managed server-side, read-only here.</p>
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1.5">
                <p className="font-medium text-gray-900 text-sm">{t.label}</p>
                <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{t.id}</span>
              </div>
              <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">{t.body}</p>
              {t.variables && t.variables.length > 0 && (
                <div className="flex gap-1.5 mt-2">
                  {t.variables.map((v) => (
                    <span key={v} className="text-[10px] font-mono bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded">
                      {'{{'}{v}{'}}'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
