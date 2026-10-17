-- CreateIndex
CREATE INDEX "documents_owner_id_updated_at_idx" ON "documents"("owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "documents_owner_id_folder_id_updated_at_idx" ON "documents"("owner_id", "folder_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "document_tags_tag_id_idx" ON "document_tags"("tag_id");
