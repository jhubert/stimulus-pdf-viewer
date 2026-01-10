class Annotation < ApplicationRecord
  include OrganizationScoped, Trashable, Searchable, XfdfRendering

  belongs_to :document
  belongs_to :person, counter_cache: true
  has_one :user, through: :person

  belongs_to :parent_annotation, class_name: "Annotation", optional: true
  has_many :replies, class_name: "Annotation", foreign_key: :parent_annotation_id, dependent: :destroy

  enum :annotation_type, %i[highlight line ink text note]

  validates :page, presence: true, numericality: { only_integer: true, greater_than: 0 }
  validates :title, length: { maximum: 255 }, allow_blank: true
  validates :subject, length: { maximum: 255 }, allow_blank: true
  validates :color, hex_color: true, allow_nil: true
  validates :opacity, numericality: { greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0 }
  validate :validate_rect_format

  before_validation :coerce_quads_and_rect, if: -> { highlight? || line? }
  after_commit :sync_document_view_annotation_count, on: [ :create, :update, :destroy ]

  scope :by_document, ->(document_id) { where(document_id: document_id) }

  with_options if: :ink? do
    validates :ink_strokes, presence: true, ink_strokes: {
      max_bytes: 3.megabytes, max_strokes: 5_000, max_points: 500_000
    }
    validates :quads, absence: true
  end

  with_options if: -> { highlight? || line? } do
    validates :quads, presence: true, quads: { max_quads: 20_000 }
    validates :ink_strokes, absence: true
  end

  def color_without_opacity
    color_with_opacity[:color]
  end

  def opacity
    color_with_opacity[:opacity]
  end

  # Setter to ensure rect is always stored as an array of four floats
  def rect=(value)
    parsed_rect = case value
    when String
      value.split(",").map(&:strip).map(&:to_f)
    when Array
      value.map(&:to_f)
    else
      value
    end

    super(parsed_rect)
  end

  def url(**params)
    Rails.application.routes.url_helpers.document_annotation_url(organization, document_id, self, params)
  end

  def to_partial_path
    "annotations/types/#{annotation_type}"
  end

  private

  def searchable_primary_text
    "Re: #{document.name}"
  end

  def searchable_secondary_text
    [ contents, title, subject ].collect(&:to_s).join(" ")
  end

  def validate_rect_format
    return if rect.empty?

    unless rect.is_a?(Array) && rect.size == 4 && rect.all? { |n| n.is_a?(Numeric) }
      errors.add(:rect, "must be an array of four numbers [x1, y1, w, h]")
    end
  end

  def color_with_opacity
    color_string = color
    derived_color = color_string.dup

    if color_string.starts_with?("#")
      hex = color_string.delete_prefix("#")

      if hex.size == 8  # Format: RRGGBBAA
        r, g, b, a = hex.scan(/../).map { |c| c.to_i(16) }
        derived_opacity = (a / 255.0).round(2)
        derived_color = format("#%02X%02X%02X", r, g, b)
      else  # Format: RRGGBB or RGB (fully opaque)
        derived_opacity = 1.0
      end
    else
      raise ArgumentError, "Invalid color value: #{color}"
    end

    { color: derived_color, opacity: derived_opacity }
  end

  def coerce_quads_and_rect
    self.quads = QuadsCoercer.normalize(quads)
    # Populate rect as union bbox if blank or empty
    if rect.blank? || rect == []
      min_x, min_y, max_x, max_y = QuadsCoercer.bounds(quads)
      # Store as [x,y,w,h]
      self.rect = [ min_x, min_y, (max_x - min_x), (max_y - min_y) ]
    end
  end

  def sync_document_view_annotation_count
    # Only sync on create, destroy, or when trashed_at changes
    return unless destroyed? || previously_new_record? || saved_change_to_trashed_at?

    DocumentView.find_by(document_id: document_id, person_id: person_id)&.sync_annotation_count
  end
end
