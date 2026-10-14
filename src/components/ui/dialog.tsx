import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useConfirm } from "@/components/ui/confirm-dialog"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>

/**
 * The portal, overlay, box and X that DialogContent and EntryDialogContent
 * share (v1.8.0 O2). `closeRef` reaches the X: an entry dialog's "Discard
 * entries" closes it through the X, exactly as a click on the X does.
 */
function dialogContentElement(
  { className, children, ...props }: DialogContentProps,
  ref: React.ForwardedRef<React.ElementRef<typeof DialogPrimitive.Content>>,
  closeRef?: React.Ref<HTMLButtonElement>,
) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-h-[85vh] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close ref={closeRef} className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>((props, ref) => {
  // W6-Design (Wave-6 follow-up): the prior implementation forced
  // `aria-describedby={undefined}` to silence Radix's "Missing
  // Description" dev warning for the many confirm-style dialogs that
  // had no separate description body. The side effect was that even
  // when a caller *did* render `<DialogDescription>`, Radix's
  // context-based auto-wiring of `aria-describedby` was overwritten by
  // `undefined` — so screen readers never announced the description.
  // Round-3 chip D: EVERY consumer now carries a description (sr-only
  // where visible helper text would be noise), enforced by
  // tests/policy/dialog-description-policy.test.ts.
  //
  // We now let Radix manage `aria-describedby`:
  //   • If the caller renders `<DialogDescription>`, Radix wires it via
  //     context and the prop reaches the DOM as the description's id.
  //   • If the caller passes their own `aria-describedby`, it flows
  //     through `{...props}` and wins.
  //   • If neither is present, Radix logs the dev-mode warning, which
  //     is the right developer-facing signal (and the policy ratchet
  //     fails CI before it gets that far).
  return dialogContentElement(props, ref);
})
DialogContent.displayName = DialogPrimitive.Content.displayName

/** The question an entry dialog asks before Escape discards what was entered
 *  (v1.8.0 O2, ⚑ CX-O2-1..3; "Stay" is FlowShell's shipped label). */
const ENTRY_DISCARD_CONFIRM = {
  title: "Discard unsaved entries?",
  description: "Anything entered here that hasn't been saved is discarded. Saved entries are not affected.",
  confirmLabel: "Discard entries",
  cancelLabel: "Stay",
}

/**
 * v1.8.0 O2 (RC2, CR-O-3): the content of an ENTRY dialog, one the user types
 * or picks values into (the onboarding "Add …" dialogs, the import preview,
 * the PDF review). Entry dialogs opt in; DialogContent itself, and the confirm
 * dialog built on it, keep closing on an overlay click.
 *
 * - A pointer-down or focus outside never dismisses it (EditDrawer's W14 #2
 *   policy): a click on the dimmed page behind a half-filled form must not
 *   eat the user's typing.
 * - Escape closes it at once while nothing has been entered. Once something
 *   has, Escape asks first (the house useConfirm). "Stay" (or Escape on the
 *   question) keeps every value and puts focus back where it was; "Discard
 *   entries" closes the dialog through its X.
 * - The X and the form's own Cancel stay immediate.
 *
 * "Entered" = an input event inside the dialog (typing, a native select, a
 * checkbox, a date field), or a change event once the user has pressed a key
 * or a pointer in it: a Radix Select pick reaches the dialog only as a change
 * event from its hidden select. A form resetting its own values fires no
 * input event, and the Radix Select hydration echo (the change its hidden
 * select fires when RHF's `values` land, house gotcha) comes before the user
 * has pressed anything, so neither marks a fresh dialog as entered. The marks
 * reset when a NEW content node mounts, i.e. on every open (Radix re-attaches
 * the same node's ref on each render, which must not reset them).
 */
const EntryDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ children, onInteractOutside, onEscapeKeyDown, onInputCapture, onChangeCapture, onKeyDownCapture, onPointerDownCapture, ...props }, ref) => {
  const { confirm, dialog } = useConfirm()
  const pressedRef = React.useRef(false)
  const enteredRef = React.useRef(false)
  const askingRef = React.useRef(false)
  const nodeRef = React.useRef<HTMLDivElement | null>(null)
  const openedNodeRef = React.useRef<HTMLDivElement | null>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const setNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== null && node !== openedNodeRef.current) {
        openedNodeRef.current = node
        pressedRef.current = false
        enteredRef.current = false
      }
      nodeRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )
  return dialogContentElement(
    {
      ...props,
      onInteractOutside: (event) => {
        onInteractOutside?.(event)
        event.preventDefault()
      },
      onKeyDownCapture: (event) => {
        onKeyDownCapture?.(event)
        pressedRef.current = true
      },
      onPointerDownCapture: (event) => {
        onPointerDownCapture?.(event)
        pressedRef.current = true
      },
      onInputCapture: (event) => {
        onInputCapture?.(event)
        enteredRef.current = true
      },
      onChangeCapture: (event) => {
        onChangeCapture?.(event)
        if (pressedRef.current) enteredRef.current = true
      },
      onEscapeKeyDown: (event) => {
        onEscapeKeyDown?.(event)
        if (event.defaultPrevented || !enteredRef.current) return
        event.preventDefault()
        if (askingRef.current) return
        askingRef.current = true
        const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
        void confirm(ENTRY_DISCARD_CONFIRM).then((discard) => {
          askingRef.current = false
          if (discard) closeRef.current?.click()
          else (returnTo?.isConnected ? returnTo : nodeRef.current)?.focus()
        })
      },
      children: (
        <>
          {children}
          {dialog}
        </>
      ),
    },
    setNode,
    closeRef
  )
})
EntryDialogContent.displayName = "EntryDialogContent"

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  EntryDialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
