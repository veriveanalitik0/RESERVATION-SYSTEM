import React, { useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, ShieldCheck, Home, BrainCircuit, FlaskConical, UserRound, CircleUserRound, UserRoundCheck } from 'lucide-react';

interface LoginFormProps {
  email: string;
  password: string;
  remember: boolean;
  loading: boolean;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onRememberChange: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onDemoFill?: (which: 'user' | 'admin' | 'danisman' | 'arge' | 'izleyici' | 'mehmet' | 'furkan' | 'fatih') => void;
  onHomeClick?: () => void;
  registerHref?: string;
  forgotHref?: string;
}

interface VideoBackgroundProps {
  videoUrl: string;
  poster?: string;
}

interface FormInputProps {
  icon: React.ReactNode;
  type: string;
  id: string;
  /** Erişilebilir etiket — görsel olarak gizli (sr-only) <label>. */
  label: string;
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
}

interface QuickButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  id: string;
}

const FormInput: React.FC<FormInputProps> = ({ icon, type, id, label, placeholder, value, onChange, autoComplete, maxLength, disabled, required }) => {
  return (
    <div className="relative">
      {/* Görsel tasarımı bozmadan ekran okuyucu için gerçek etiket
          (placeholder etiket yerine geçmez). */}
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">{icon}</div>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        maxLength={maxLength}
        disabled={disabled}
        required={required}
        className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-kt-gold-400/60 focus:ring-2 focus:ring-kt-gold-400/20 transition-colors disabled:opacity-60"
      />
    </div>
  );
};

const QuickButton: React.FC<QuickButtonProps> = ({ icon, label, onClick, title }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex flex-col items-center justify-center gap-1 py-2 bg-white/5 border border-white/10 rounded-lg text-white/70 hover:bg-white/10 hover:text-kt-gold-300 hover:border-kt-gold-400/40 transition-colors"
    >
      {icon}
      <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
    </button>
  );
};

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, id }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      onClick={onChange}
      className="relative inline-block w-10 h-5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-kt-gold-400/40 rounded-full"
    >
      <span className="sr-only">Toggle remember</span>
      <div className={`absolute inset-0 rounded-full transition-colors duration-200 ease-in-out ${checked ? 'bg-kt-gold-500' : 'bg-white/20'}`}>
        <div className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${checked ? 'transform translate-x-5' : ''}`} />
      </div>
    </button>
  );
};

const VideoBackground: React.FC<VideoBackgroundProps> = ({ videoUrl, poster }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch((err) => {
        // Autoplay may be blocked; poster + dark overlay remain visible.
        console.warn('Video autoplay failed:', err);
      });
    }
  }, []);
  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden">
      {/* Dark overlay for readability + cyan/violet AI tint */}
      <div className="absolute inset-0 z-10 bg-gradient-to-br from-kt-green-950/80 via-kt-green-900/60 to-kt-green-950/85" />
      <div className="absolute inset-0 z-10 bg-neural-grid-dark opacity-20 pointer-events-none" />
      <video
        ref={videoRef}
        className="absolute inset-0 min-w-full min-h-full object-cover w-auto h-auto"
        autoPlay
        loop
        muted
        playsInline
        poster={poster}
      >
        <source src={videoUrl} type="video/mp4" />
      </video>
    </div>
  );
};

const LoginForm: React.FC<LoginFormProps> = ({
  email,
  password,
  remember,
  loading,
  onEmailChange,
  onPasswordChange,
  onRememberChange,
  onSubmit,
  onDemoFill,
  onHomeClick,
  registerHref = '/register',
  forgotHref = '#',
}) => {
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <div className="relative p-8 rounded-2xl backdrop-blur-md bg-black/55 border border-white/10 shadow-2xl">
      {/* Card glow accents — AI cyan/violet vibe */}
      <div className="absolute -top-16 -right-16 w-44 h-44 bg-kt-gold-400/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-16 -left-16 w-44 h-44 bg-kt-violet-500/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2">
            Kuveyt Türk <span className="text-shimmer">Yapay Zeka Laboratuvarı</span>
          </h2>
          <p className="text-sm text-white/65 tracking-tight">
            Hesabınıza giriş yaparak çalışma istasyonu randevularınıza erişin.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5" autoComplete="on">
          <FormInput
            id="email"
            label="E-posta adresi"
            icon={<Mail className="text-white/60" size={18} />}
            type="email"
            placeholder="E-posta adresin"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            autoComplete="email"
            maxLength={254}
            disabled={loading}
            required
          />

          <div className="relative">
            <FormInput
              id="password"
              label="Parola"
              icon={<Lock className="text-white/60" size={18} />}
              type={showPassword ? 'text' : 'password'}
              placeholder="Parola"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              autoComplete="current-password"
              maxLength={128}
              disabled={loading}
              required
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white focus:outline-none transition-colors"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ToggleSwitch
                id="remember-me"
                checked={remember}
                onChange={() => onRememberChange(!remember)}
              />
              <label
                id="remember-me-label"
                htmlFor="remember-me"
                className="text-sm text-white/80 cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => onRememberChange(!remember)}
              >
                Beni hatırla
              </label>
            </div>
            <Link to={forgotHref} className="text-sm text-white/70 hover:text-kt-gold-300 transition-colors">
              Parolanı mı unuttun?
            </Link>
          </div>

          <button type="submit" disabled={loading} className="btn-pill-primary btn-pill-md w-full">
            <span className="btn-pill-shimmer" />
            <span className="relative z-10 font-semibold">
              {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
            </span>
          </button>
        </form>

        {(onDemoFill || onHomeClick) && (
          <div className="mt-8">
            <div className="relative flex items-center justify-center">
              <div className="border-t border-white/10 absolute w-full" />
              <div className="bg-transparent px-4 relative text-white/50 text-[11px] uppercase tracking-[0.2em]">
                hızlı erişim
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {onDemoFill && (
                <QuickButton
                  icon={<User size={18} />}
                  label="Kullanıcı"
                  title="Demo kullanıcı bilgilerini doldur"
                  onClick={() => onDemoFill('user')}
                />
              )}
              {onDemoFill && (
                <QuickButton
                  icon={<ShieldCheck size={18} />}
                  label="Admin"
                  title="Demo Lab Mühendisi (admin) bilgilerini doldur"
                  onClick={() => onDemoFill('admin')}
                />
              )}
              {onDemoFill && (
                <QuickButton
                  icon={<BrainCircuit size={18} />}
                  label="Danışman"
                  title="Analitik Danışman demo hesabını doldur (Ayşe Yılmaz)"
                  onClick={() => onDemoFill('danisman')}
                />
              )}
              {onDemoFill && (
                <QuickButton
                  icon={<FlaskConical size={18} />}
                  label="Ar-Ge"
                  title="YZ / Ar-Ge Mühendisi demo hesabını doldur (Burak Şahin)"
                  onClick={() => onDemoFill('arge')}
                />
              )}
              {onDemoFill && (
                <QuickButton
                  icon={<Eye size={18} />}
                  label="İzleyici"
                  title="İzleyici (salt-okunur) demo hesabını doldur (Gözlem Yetkilisi)"
                  onClick={() => onDemoFill('izleyici')}
                />
              )}
              {onDemoFill && (
                <QuickButton
                  icon={<UserRound size={18} />}
                  label="Mehmet"
                  title="Mehmet Murat Huyut hesabını doldur"
                  onClick={() => onDemoFill('mehmet')}
                />
              )}
              {onDemoFill && (
                <QuickButton
                  icon={<CircleUserRound size={18} />}
                  label="Furkan"
                  title="Furkan Koçal hesabını doldur"
                  onClick={() => onDemoFill('furkan')}
                />
              )}
              {onDemoFill && (
                <QuickButton
                  icon={<UserRoundCheck size={18} />}
                  label="Fatih"
                  title="Fatih Baday hesabını doldur"
                  onClick={() => onDemoFill('fatih')}
                />
              )}
              {onHomeClick && (
                <QuickButton
                  icon={<Home size={18} />}
                  label="Ana sayfa"
                  title="Ana sayfaya dön"
                  onClick={onHomeClick}
                />
              )}
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-sm text-white/60">
          Hesabın yok mu?{' '}
          <Link to={registerHref} className="font-semibold text-kt-gold-300 hover:text-kt-gold-200 transition-colors">
            Kayıt ol →
          </Link>
        </p>
      </div>
    </div>
  );
};

const LoginPage = {
  LoginForm,
  VideoBackground,
};

export default LoginPage;
