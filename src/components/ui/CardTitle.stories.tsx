import { CardTitle } from "@/components/ui/CardTitle";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Meta, StoryObj } from "@/lib/story";
import React, { type ComponentProps } from "react";

type CardTitleProps = ComponentProps<typeof CardTitle>;

const meta = {
  title: "UI/Card Title",
  component: CardTitle,
  args: { children: "Knowledge Studio" },
} satisfies Meta<CardTitleProps>;
export default meta;

export const Default: StoryObj<CardTitleProps> = {};
export const InCard: StoryObj<CardTitleProps> = {
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle {...args} />
      </CardHeader>
      <CardContent>Ready to review</CardContent>
    </Card>
  ),
};
