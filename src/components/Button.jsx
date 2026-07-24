// Every variant is struck from the shared button metal in src/index.css
// (.fm-btn + tokens) so a Button, a .cb-* control and a .wm-* control are the
// same object on screen. Add a variant there before adding one here.
const BUTTON_VARIANTS = {
  primary:   'fm-btn fm-btn--ember',
  secondary: 'fm-btn',
  brass:     'fm-btn fm-btn--brass',
  danger:    'fm-btn fm-btn--blood',
  success:   'fm-btn fm-btn--verdigris',
  ghost:     'fm-btn fm-btn--ghost',
  iron:      'fm-btn fm-btn--iron',
  // Legacy Forgemark aliases — kept so existing call sites keep working.
  forgePrimary:   'fm-btn fm-btn--ember',
  forgeSecondary: 'fm-btn fm-btn--iron',
  forgeGhost:     'fm-btn fm-btn--ghost',
}

// .fm-btn sets its own padding/font-size; sizes are its own modifiers.
const BUTTON_SIZES = { sm: 'fm-btn--sm', md: '', lg: 'fm-btn--lg' }

/**
 * Reusable button.
 *   variant: primary (ember, one per view) | secondary | brass | danger |
 *            success | ghost | iron
 *   size:    sm | md | lg
 *   Full width via className="w-full".
 * Disabled state handled automatically by .fm-btn:disabled.
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  disabled = false,
  className = '',
  children,
  ...props
}) {
  const variantClass = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary
  const sizeClass = BUTTON_SIZES[size] ?? ''
  return (
    <button
      disabled={disabled}
      class={`${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
