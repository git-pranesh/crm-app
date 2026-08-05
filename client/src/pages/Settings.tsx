import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Gift, MessageCircle } from 'lucide-react';
import { api } from '../lib/api';
import { getStoredUser } from '../lib/auth';

interface SLAConfig {
  rule: string;
  thresholdHours: number;
  updatedAt?: string;
}

interface Offer {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  startDate?: string;
  endDate?: string;
}

interface WATemplate {
  id: string;
  label: string;
  body: string;
  note?: string;
}

const SLA_ROWS: { rule: string; label: string }[] = [
  { rule: 'FIRST_CONTACT_24H',  label: 'First contact within N hours of creation' },
  { rule: 'LEAD_TO_MQL_5D',    label: 'Reach MQL within N hours (legacy Effective Lead cleanup)' },
  { rule: 'MQL_TO_DQL_5D',     label: 'DQL meeting scheduled within N hours of MQL' },
  { rule: 'PROPOSAL_TO_PP_2D', label: 'PP meeting scheduled within N hours of Proposal Ready' },
];

export default function Settings() {
  const navigate = useNavigate();
  const user = getStoredUser();

  useEffect(() => {
    if (!user) { navigate('/login', { replace: true }); return; }
    if (user.role !== 'BRANCH_HEAD') {
      toast.error("You don't have access to Settings.");
      navigate('/dashboard', { replace: true });
    }
  }, []);

  const [slaMap, setSlaMap]           = useState<Record<string, number>>({});
  const [editHours, setEditHours]     = useState<Record<string, string>>({});
  const [savingSLA, setSavingSLA]     = useState<string | null>(null);
  const [savedSLA, setSavedSLA]       = useState<Record<string, boolean>>({});

  const [offers, setOffers]           = useState<Offer[]>([]);
  const [toggling, setToggling]       = useState<string | null>(null);
  const [newOfferName, setNewOfferName] = useState('');
  const [addingOffer, setAddingOffer] = useState(false);

  const [templates, setTemplates]     = useState<WATemplate[]>([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    if (user?.role !== 'BRANCH_HEAD') return;
    Promise.all([
      api.get<{ configs: SLAConfig[] }>('/admin/sla-config'),
      api.get<{ offers: Offer[] }>('/offers'),
      api.get<{ templates: WATemplate[] }>('/admin/whatsapp-templates'),
    ]).then(([sla, off, wa]) => {
      const m: Record<string, number> = {};
      const e: Record<string, string> = {};
      for (const c of (sla.configs ?? [])) {
        m[c.rule] = c.thresholdHours;
        e[c.rule] = String(c.thresholdHours);
      }
      setSlaMap(m);
      setEditHours(e);
      setOffers(off.offers ?? []);
      setTemplates(wa.templates ?? []);
    }).catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const saveSLA = async (rule: string) => {
    const val = parseInt(editHours[rule] ?? '', 10);
    if (!val || val < 1) { toast.error('Enter a valid number of hours (≥ 1)'); return; }
    setSavingSLA(rule);
    try {
      const data = await api.patch<{ config: SLAConfig }>(`/admin/sla-config/${rule}`, { thresholdHours: val });
      const updated = data.config.thresholdHours;
      setSlaMap((m) => ({ ...m, [rule]: updated }));
      setEditHours((h) => ({ ...h, [rule]: String(updated) }));
      setSavedSLA((s) => ({ ...s, [rule]: true }));
      setTimeout(() => setSavedSLA((s) => ({ ...s, [rule]: false })), 2000);
    } catch (err: any) {
      toast.error(err.message ?? 'Save failed');
    } finally {
      setSavingSLA(null);
    }
  };

  const toggleOffer = async (id: string, current: boolean) => {
    setToggling(id);
    setOffers((prev) => prev.map((o) => o.id === id ? { ...o, isActive: !current } : o));
    try {
      const data = await api.patch<{ offer: Offer }>(`/offers/${id}/toggle`, { isActive: !current });
      setOffers((prev) => prev.map((o) => o.id === id ? { ...o, isActive: data.offer.isActive } : o));
    } catch (err: any) {
      setOffers((prev) => prev.map((o) => o.id === id ? { ...o, isActive: current } : o));
      toast.error(err.message ?? 'Toggle failed');
    } finally {
      setToggling(null);
    }
  };

  const addOffer = async () => {
    const name = newOfferName.trim();
    if (!name) { toast.error('Offer name cannot be empty'); return; }
    setAddingOffer(true);
    try {
      const data = await api.post<{ offer: Offer }>('/offers', { name, isActive: true });
      setOffers((prev) => [...prev, data.offer]);
      setNewOfferName('');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to add offer');
    } finally {
      setAddingOffer(false);
    }
  };

  if (!user || user.role !== 'BRANCH_HEAD') return null;

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">SLA rules, offers &amp; message templates</p>
      </div>

      {/* A + B side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Section A — SLA Rules */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-base">🕐</span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">SLA rules</h2>
                <p className="text-xs text-gray-400 mt-0.5">Response-time thresholds (IST). The clock pauses while a lead is On Hold.</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {SLA_ROWS.map(({ rule, label }) => {
              const stored = slaMap[rule] ?? 0;
              const editing = editHours[rule] ?? String(stored);
              const dirty = editing !== String(stored);
              const saving = savingSLA === rule;
              const saved  = savedSLA[rule];
              return (
                <div key={rule} className="px-5 py-3.5">
                  <p className="text-xs text-gray-700 mb-2 leading-snug">{label}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={editing}
                      onChange={(e) => setEditHours((h) => ({ ...h, [rule]: e.target.value }))}
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 text-center"
                    />
                    <span className="text-xs text-gray-400">hours</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      {saved ? (
                        <span className="text-green-600 font-medium text-sm">✓ Saved</span>
                      ) : (
                        <button
                          onClick={() => saveSLA(rule)}
                          disabled={saving || !dirty}
                          className="text-xs font-medium px-3 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1"
                        >
                          {saving ? (
                            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : '💾'}
                          <span>{saving ? 'Saving…' : 'Save'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section B — Offers & Schemes */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Gift size={16} strokeWidth={1.8} className="text-stone-500" />
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Offers &amp; schemes</h2>
                <p className="text-xs text-gray-400 mt-0.5">Seasonal offers that can be tagged on a lead or quote.</p>
              </div>
            </div>
          </div>
          <div className="px-5 py-4">
            {offers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No offers yet — add one below.</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-4">
                {offers.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => toggleOffer(o.id, o.isActive)}
                    disabled={toggling === o.id}
                    title={o.isActive ? 'Click to deactivate' : 'Click to activate'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      o.isActive
                        ? 'bg-brand-500 border-brand-500 text-white hover:bg-brand-600'
                        : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${o.isActive ? 'bg-white' : 'bg-gray-400'}`}
                    />
                    {o.name}
                    <span className={`text-[10px] ml-0.5 ${o.isActive ? 'text-white/70' : 'text-gray-400'}`}>
                      {o.isActive ? 'ON' : 'OFF'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Add new offer */}
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <input
                value={newOfferName}
                onChange={(e) => setNewOfferName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addOffer()}
                placeholder="e.g. Summer Special"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              <button
                onClick={addOffer}
                disabled={addingOffer || !newOfferName.trim()}
                className="px-3 py-1.5 text-sm font-medium bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-lg transition-colors whitespace-nowrap"
              >
                {addingOffer ? '…' : '+ Add'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section C — WhatsApp Templates (full width) */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} strokeWidth={1.8} className="text-stone-500" />
            <div>
              <h2 className="text-sm font-semibold text-gray-900">WhatsApp templates</h2>
              <p className="text-xs text-gray-400 mt-0.5">Pre-approved message templates used across the automation flows. Read-only here.</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {templates.map((t) => (
            <div key={t.id} className="px-5 py-4">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-sm font-semibold text-gray-900">{t.label}</p>
                <span className="text-[10px] font-mono bg-gray-50 border border-gray-100 text-gray-400 px-1.5 py-0.5 rounded">
                  {t.id}
                </span>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-xs text-gray-600 leading-relaxed whitespace-pre-wrap select-text cursor-text">
                {t.body}
              </div>
              {t.note && (
                <p className="text-[10px] text-gray-400 mt-1.5 italic">{t.note}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
