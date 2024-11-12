"use client"

import { addToCartBulk, deleteLineItem, updateLineItem } from "@lib/data/cart"
import { addToCartEventBus } from "@lib/data/cart-event-bus"
import type {
  StoreCart,
  StoreCartLineItem,
  StoreProduct,
  StoreProductVariant,
} from "@medusajs/types"
import { Toaster, toast } from "@medusajs/ui"
import { useParams } from "next/navigation"
import type { PropsWithChildren } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useTransition,
} from "react"
import { B2BCart } from "types/global"

export type AddToCartEventPayload = {
  lineItems: {
    productVariant: StoreProductVariant & {
      product: StoreProduct
    }
    quantity: number
  }[]
  regionId: string
}

const CartContext = createContext<
  | {
      cart: B2BCart | null
      handleDeleteItem: (lineItem: string) => Promise<void>
      handleUpdateCartQuantity: (
        lineItem: string,
        newQuantity: number
      ) => Promise<void>
    }
  | undefined
>(undefined)

export function CartProvider({
  cart,
  children,
}: PropsWithChildren<{
  cart: B2BCart | null
}>) {
  const { countryCode } = useParams()

  const [optimisticCart, setOptimisticCart] = useOptimistic<B2BCart | null>(
    cart
  )

  const [, startTransition] = useTransition()

  const handleOptimisticAddToCart = useCallback(
    async (payload: AddToCartEventPayload) => {
      let prevCart = {} as B2BCart

      startTransition(async () => {
        setOptimisticCart((prev) => {
          prevCart = structuredClone(prev) as B2BCart

          const items = [...(prev?.items || [])]

          const lineItems = payload.lineItems

          const newItems: StoreCartLineItem[] = [...items]

          for (const lineItem of lineItems) {
            const existingItemIndex = newItems.findIndex(
              ({ variant }) => variant?.id === lineItem.productVariant.id
            )

            if (existingItemIndex > -1) {
              const item = newItems[existingItemIndex]

              newItems[existingItemIndex] = {
                ...item,
                quantity: item.quantity + lineItem.quantity,
              }

              continue
            }

            const priceAmount =
              lineItem.productVariant.calculated_price?.calculated_amount || 0

            const newItem: StoreCartLineItem = {
              cart: prev || ({} as StoreCart),
              cart_id: prev?.id || "",
              discount_tax_total: 0,
              discount_total: 0,
              id: generateOptimisticItemId(lineItem.productVariant.id),
              is_discountable: false,
              is_tax_inclusive: false,
              item_subtotal: priceAmount,
              item_tax_total: 0,
              item_total: priceAmount,
              original_subtotal: priceAmount,
              original_tax_total: 0,
              original_total: priceAmount,
              product: lineItem.productVariant.product || undefined,
              quantity: lineItem.quantity,
              requires_shipping: true,
              subtotal: priceAmount,
              tax_total: 0,
              title: lineItem.productVariant.title || "",
              total: priceAmount,
              thumbnail:
                lineItem.productVariant.product?.thumbnail || undefined,
              unit_price: priceAmount,
              variant: lineItem.productVariant || undefined,
              // @ts-expect-error
              created_at: new Date().toISOString(),
            }

            newItems.push(newItem)
          }

          const newTotal = calculateCartTotal(newItems)

          return {
            ...prev,
            item_subtotal: newTotal,
            items: newItems,
          } as B2BCart
        })

        await addToCartBulk({
          lineItems: payload.lineItems.map((lineItem) => ({
            variant_id: lineItem.productVariant.id,
            quantity: lineItem.quantity,
          })),
          countryCode: countryCode as string,
        }).catch((e) => {
          toast.error("Failed to add to cart")
          setOptimisticCart(prevCart)
        })
      })
    },
    [setOptimisticCart]
  )

  useEffect(() => {
    addToCartEventBus.registerCartAddHandler(handleOptimisticAddToCart)
  }, [handleOptimisticAddToCart])

  const handleDeleteItem = async (lineItem: string) => {
    const item = optimisticCart?.items?.find(({ id }) => id === lineItem)

    if (!item) return

    let prevCart = {} as B2BCart

    startTransition(() => {
      setOptimisticCart((prev) => {
        if (!prev) return prev

        prevCart = structuredClone(prev) as B2BCart

        const optimisticItems = prev.items?.filter(({ id }) => id !== lineItem)

        const optimisticTotal = optimisticItems?.reduce(
          (acc, item) => acc + item.unit_price * item.quantity,
          0
        )

        return {
          ...prev,
          item_subtotal: optimisticTotal || 0,
          items: optimisticItems,
        }
      })
    })

    await deleteLineItem(lineItem).catch((e) => {
      toast.error("Failed to delete item")
      setOptimisticCart(prevCart)
    })
  }

  const handleUpdateCartQuantity = async (
    lineItem: string,
    quantity: number
  ) => {
    const item = optimisticCart?.items?.find(({ id }) => id === lineItem)

    if (!item) return

    let prevCart = {} as B2BCart

    startTransition(() => {
      setOptimisticCart((prev) => {
        if (!prev) return prev

        prevCart = structuredClone(prev) as B2BCart

        const optimisticItems = prev.items?.reduce(
          (acc: StoreCartLineItem[], item) => {
            if (item.id === lineItem) {
              return quantity === 0 ? acc : [...acc, { ...item, quantity }]
            }
            return [...acc, item]
          },
          []
        )

        const optimisticTotal = optimisticItems?.reduce(
          (acc, item) => acc + item.unit_price * item.quantity,
          0
        )

        return {
          ...prev,
          item_subtotal: optimisticTotal || 0,
          items: optimisticItems,
        }
      })
    })

    if (!isOptimisticItemId(lineItem)) {
      await updateLineItem({
        lineId: lineItem,
        data: { quantity },
      }).catch((e) => {
        toast.error("Failed to update cart quantity")
        setOptimisticCart(prevCart)
      })
    }
  }

  const sortedItems = useMemo(() => {
    return optimisticCart?.items?.sort((a, b) => {
      return (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 1
    })
  }, [optimisticCart])

  return (
    <CartContext.Provider
      value={{
        cart: { ...optimisticCart, items: sortedItems } as B2BCart,
        handleDeleteItem,
        handleUpdateCartQuantity,
      }}
    >
      {children}
      <Toaster className="z-[99999]" position="bottom-left" />
    </CartContext.Provider>
  )
}

export const useCart = () => {
  const context = useContext(CartContext)
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider")
  }
  return context
}

const OPTIMISTIC_ITEM_ID_PREFIX = "__optimistic__"

function generateOptimisticItemId(variantId: string) {
  return `${OPTIMISTIC_ITEM_ID_PREFIX}-${variantId}`
}

export function isOptimisticItemId(id: string) {
  return id.startsWith(OPTIMISTIC_ITEM_ID_PREFIX)
}

function calculateCartTotal(cartItems: StoreCartLineItem[]) {
  return (
    cartItems.reduce((acc, item) => acc + item.unit_price * item.quantity, 0) ||
    0
  )
}
