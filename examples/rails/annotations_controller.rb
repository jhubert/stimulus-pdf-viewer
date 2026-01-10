class AnnotationsController < ApplicationController
  require_organization

  before_action :set_document
  before_action :set_annotation, only: %i[ show edit update destroy restore ]

  # GET /annotations or /annotations.json
  def index
    authorize @document, :show?

    @page_heights =
        begin
          JSON.parse(params[:page_heights]) if params[:page_heights].present?
        rescue JSON::ParserError
          nil
        end || []
    @annotations = current_person.annotations.kept.by_document(@document).includes(:user).order(created_at: :desc)

    respond_to do |format|
      format.html
      format.json { render json: @annotations }
      format.xfdf { render :index, formats: [ :xfdf ] }
    end
  end

  # GET /annotations/1 or /annotations/1.json
  def show
    authorize @annotation
    redirect_to document_path(@annotation.document, anchor: view_context.dom_id(@annotation))
  end

  # POST /annotations or /annotations.json
  def create
    @annotation = @document.annotations.build(annotation_params)
    @annotation.organization = @organization
    @annotation.person = current_person
    authorize @annotation

    respond_to do |format|
      if @annotation.save
        format.turbo_stream { head :ok }
        format.html { redirect_to document_annotation_path(@organization, @document, @annotation), notice: "Annotation was successfully created." }
        format.json { render json: @annotation, status: :created, location: document_annotation_path(@organization, @document, @annotation) }
      else
        format.html { head :unprocessable_content }
        format.json { render json: @annotation.errors, status: :unprocessable_content }
      end
    end
  end

  def edit
    authorize @annotation
  end

  # PATCH/PUT /annotations/1 or /annotations/1.json
  def update
    authorize @annotation

    respond_to do |format|
      if @annotation.update(annotation_params)
        format.html { redirect_to document_annotation_path(@organization, @document, @annotation), notice: "Annotation was successfully updated." }
        format.json { render json: @annotation, status: :ok }
        format.turbo_stream { head :no_content }
      else
        format.html { head :unprocessable_content }
        format.json { render json: @annotation.errors, status: :unprocessable_content }
        format.turbo_stream { head :unprocessable_content }
      end
    end
  end

  # DELETE /annotations/1 or /annotations/1.json
  def destroy
    authorize @annotation

    @annotation.trash!

    respond_to do |format|
      format.html { redirect_to @document, status: :see_other, notice: "Annotation was successfully destroyed." }
      format.json { head :no_content }
      format.turbo_stream { head :no_content }
    end
  end

  # PATCH /annotations/1/restore
  def restore
    authorize @annotation

    @annotation.restore!

    respond_to do |format|
      format.html { redirect_to @document, notice: "Annotation was successfully restored." }
      format.json { render json: @annotation, status: :ok }
    end
  end

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_document
      @document = @organization.documents.find(params.expect(:document_id))
    end

    def set_annotation
      # Include trashed annotations for restore action
      scope = action_name == "restore" ? @document.annotations.trashed : @document.annotations.kept
      @annotation = scope.find(params.expect(:id))
    end

    # Only allow a list of trusted parameters through.
    def annotation_params
      permitted = params.require(:annotation).permit(
        :id,
        :organization_id,
        :person_id,
        :document_id,
        :annotation_type,
        :page,
        :color,
        :opacity,
        :thickness,
        :contents,
        :title,
        :subject,
        :parent_annotation_id,
        rect: [],
        ink_strokes: [ points: [ :x, :y, :p, :t ] ]
      )

      # Permit quads separately - the nested structure is validated by QuadsValidator
      if params[:annotation][:quads].present?
        permitted[:quads] = params[:annotation][:quads].map do |q|
          q.permit(p1: [ :x, :y ], p2: [ :x, :y ], p3: [ :x, :y ], p4: [ :x, :y ]).to_h
        end
      end

      permitted
    end
end
